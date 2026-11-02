import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TranscriptChunk } from "@dawwen/asr";

export interface PreparedAudio {
  buffer: Buffer;
  /** Total duration in seconds when ffprobe succeeded. */
  durationSeconds?: number;
  /** Timed chunks (16 kHz mono WAV) for chunked ASR; omitted for short audio. */
  chunks?: TranscriptChunk[];
}

export interface PrepareOptions {
  /** Chunk length in seconds for long audio (upstream recommends ~20 s). */
  chunkSeconds: number;
  log: {
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    info: (msg: string, meta?: Record<string, unknown>) => void;
  };
  ffmpegPath?: string;
  ffprobePath?: string;
}

let ffmpegAvailable: boolean | undefined;

async function executableExists(binary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(binary, ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function isFfmpegAvailable(binary = "ffmpeg"): Promise<boolean> {
  if (ffmpegAvailable === undefined) {
    ffmpegAvailable = await executableExists(binary);
  }
  return ffmpegAvailable;
}

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderrChunks: Buffer[] = [];
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").slice(-400);
      reject(new Error(`${binary} exited with code ${code}: ${stderr}`));
    });
  });
}

/** Spawns a binary with `input` written to its stdin. */
function runWithStdin(binary: string, args: string[], input: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderrChunks: Buffer[] = [];
    const child = spawn(binary, args, { stdio: ["pipe", "ignore", "pipe"] });
    child.stdin?.on("error", () => {
      /* EPIPE when ffmpeg closes stdin early is harmless */
    });
    child.stdin?.end(input);
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").slice(-400);
      reject(new Error(`${binary} exited with code ${code}: ${stderr}`));
    });
  });
}

/** `ffprobe -show_entries format=duration -of default=nw=1:nk=1 <file>` */
function probeDurationSecs(path: string, binary: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const child = spawn(
      binary,
      ["-hide_banner", "-loglevel", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      if (code !== 0) return resolve(undefined);
      const value = Number.parseFloat(stdout.trim());
      resolve(Number.isFinite(value) && value > 0 ? value : undefined);
    });
  });
}

/**
 * Best-effort audio preparation before ASR (ADR-018):
 *
 * 1. Convert the recording to 16 kHz mono PCM WAV — the format QwenCleo expects.
 * 2. Measure the real duration with ffprobe (usage metering + full-length
 *    segments for providers that return no timestamps).
 * 3. For long recordings, cut the WAV into ~N-second chunks so
 *    `asrClient.transcribeChunked` can produce real per-chunk timestamps
 *    (the QwenCleo FastAPI server returns text only).
 *
 * Transparent fallback: on any failure the ORIGINAL buffer is returned
 * unchanged, so the pipeline behaves exactly as before this feature.
 */
export async function prepareAudioForAsr(
  input: Buffer,
  options: PrepareOptions,
): Promise<PreparedAudio> {
  const { chunkSeconds, log } = options;
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const ffprobe = options.ffprobePath ?? "ffprobe";

  try {
    if (!(await isFfmpegAvailable(ffmpeg))) {
      log.warn("ffmpeg not found; sending original audio bytes to ASR", {});
      return { buffer: input };
    }
    const canProbe = await executableExists(ffprobe);
    if (!canProbe) {
      log.warn("ffprobe not found; duration unavailable, chunking disabled", {});
    }

    const dir = await mkdtemp(join(tmpdir(), "dawwen-asr-"));
    try {
      const wavPath = join(dir, "audio.wav");
      await runWithStdin(
        ffmpeg,
        ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "wav", wavPath],
        input,
      );

      const duration = canProbe ? await probeDurationSecs(wavPath, ffprobe) : undefined;
      if (duration === undefined) {
        return { buffer: await readFile(wavPath) };
      }
      if (duration <= chunkSeconds) {
        return { buffer: await readFile(wavPath), durationSeconds: duration };
      }

      await run(ffmpeg, [
        "-hide_banner", "-loglevel", "error",
        "-i", wavPath,
        "-f", "segment",
        "-segment_time", String(chunkSeconds),
        "-reset_timestamps", "1",
        join(dir, "seg_%05d.wav"),
      ]);

      const files = (await readdir(dir))
        .filter((f) => f.startsWith("seg_") && f.endsWith(".wav"))
        .sort();

      const chunks: TranscriptChunk[] = [];
      let cursorMs = 0;
      for (const file of files) {
        const buffer = await readFile(join(dir, file));
        const chunkDuration = canProbe ? await probeDurationSecs(join(dir, file), ffprobe) : undefined;
        const startMs = cursorMs;
        const endMs = Math.round(
          cursorMs + (chunkDuration !== undefined ? chunkDuration * 1000 : chunkSeconds * 1000),
        );
        chunks.push({ buffer, startMs, endMs });
        cursorMs = endMs;
      }

      if (chunks.length > 0) {
        return { buffer: input, durationSeconds: duration, chunks };
      }
      return { buffer: await readFile(wavPath), durationSeconds: duration };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch (err) {
    log.warn("audio preparation failed; falling back to original audio", {
      error: (err as Error).message,
    });
    return { buffer: input };
  }
}
