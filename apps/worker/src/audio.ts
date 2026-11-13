import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapWithConcurrency, type TranscriptChunk } from "@dawwen/asr";

export interface PreparedAudio {
  /** File to send when the audio is not chunked (converted WAV, or the input on fallback). */
  path: string;
  /** Total duration in seconds when ffprobe succeeded. */
  durationSeconds?: number;
  /** Timed chunk files (16 kHz mono WAV) for chunked ASR; omitted for short audio. */
  chunks?: TranscriptChunk[];
  /** Deletes the temporary files (call after ASR). */
  cleanup: () => Promise<void>;
}

/** One planned chunk: seconds in the original recording. */
export interface ChunkPlan {
  /** Where the chunk's own audio starts (reported segment start). */
  start: number;
  /** End of the chunk (exclusive), or the recording's end for the last one. */
  end: number;
  /** Seconds of the previous chunk repeated before `start` (0 for the first chunk). */
  leadIn: number;
}

/**
 * Splits `duration` seconds into ~`chunkSeconds` chunks (ADR-024). Each chunk
 * after the first also covers the `overlapSeconds` before it, so a word cut at
 * the boundary is heard whole once. A tail shorter than 1 s joins the last chunk.
 */
export function planChunks(
  duration: number,
  chunkSeconds: number,
  overlapSeconds: number,
): ChunkPlan[] {
  let count = Math.max(1, Math.ceil(duration / chunkSeconds));
  if (count > 1 && duration - (count - 1) * chunkSeconds < 1) count--;
  return Array.from({ length: count }, (_, i) => {
    const start = i * chunkSeconds;
    return {
      start,
      end: i === count - 1 ? duration : (i + 1) * chunkSeconds,
      leadIn: i === 0 ? 0 : Math.min(overlapSeconds, start),
    };
  });
}

export interface PrepareOptions {
  /** Chunk length in seconds for long audio (upstream recommends ~20 s). */
  chunkSeconds: number;
  /** Seconds each chunk repeats from the previous one (ADR-024). Default 2. */
  overlapSeconds?: number;
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
 * Best-effort audio preparation before ASR (ADR-018, ADR-024):
 *
 * 1. Convert the recording (a file on disk) to 16 kHz mono PCM WAV, the format
 *    QwenCleo expects.
 * 2. Measure the real duration with ffprobe (usage metering + full-length
 *    segments for providers that return no timestamps).
 * 3. For long recordings, cut the WAV into ~N-second chunk files with a short
 *    overlap, so `asrClient.transcribeChunked` can run them in parallel and
 *    produce real per-chunk timestamps (the QwenCleo server returns text only).
 *
 * Nothing is loaded into memory: chunks are files, removed by `cleanup()`.
 * Transparent fallback: on any failure the ORIGINAL file is used unchanged.
 */
export async function prepareAudioForAsr(
  inputPath: string,
  options: PrepareOptions,
): Promise<PreparedAudio> {
  const { chunkSeconds, log } = options;
  const overlapSeconds = options.overlapSeconds ?? 2;
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const ffprobe = options.ffprobePath ?? "ffprobe";
  const original: PreparedAudio = { path: inputPath, cleanup: async () => undefined };

  let dir: string | undefined;
  const cleanup = async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  };

  try {
    if (!(await isFfmpegAvailable(ffmpeg))) {
      log.warn("ffmpeg not found; sending original audio to ASR", {});
      return original;
    }
    const canProbe = await executableExists(ffprobe);
    if (!canProbe) {
      log.warn("ffprobe not found; duration unavailable, chunking disabled", {});
    }

    dir = await mkdtemp(join(tmpdir(), "dawwen-asr-"));
    const wavPath = join(dir, "audio.wav");
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      "-i", inputPath,
      "-ac", "1", "-ar", "16000", "-f", "wav", wavPath,
    ]);

    const duration = canProbe ? await probeDurationSecs(wavPath, ffprobe) : undefined;
    if (duration === undefined) {
      return { path: wavPath, cleanup };
    }
    if (duration <= chunkSeconds) {
      return { path: wavPath, durationSeconds: duration, cleanup };
    }

    const workDir = dir;
    const plans = planChunks(duration, chunkSeconds, overlapSeconds);
    const chunks = await mapWithConcurrency(plans, 4, async (plan, index) => {
      const path = join(workDir, `seg_${String(index).padStart(5, "0")}.wav`);
      const from = plan.start - plan.leadIn;
      await run(ffmpeg, [
        "-hide_banner", "-loglevel", "error",
        "-ss", from.toFixed(3),
        ...(index === plans.length - 1 ? [] : ["-t", (plan.end - from).toFixed(3)]),
        "-i", wavPath,
        "-c", "copy",
        path,
      ]);
      const chunk: TranscriptChunk = {
        path,
        startMs: Math.round(plan.start * 1000),
        endMs: Math.round(plan.end * 1000),
        leadInMs: Math.round(plan.leadIn * 1000),
      };
      return chunk;
    });

    return { path: wavPath, durationSeconds: duration, chunks, cleanup };
  } catch (err) {
    log.warn("audio preparation failed; falling back to original audio", {
      error: (err as Error).message,
    });
    await cleanup().catch(() => undefined);
    return original;
  }
}
