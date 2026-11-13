import { normalizeCodeSwitchedText } from "../post-processor.js";
import { mapWithConcurrency, removeOverlapPrefix } from "../chunking.js";
import type {
  SpeechToText,
  TranscribeOptions,
  TranscriptionResult,
  TranscriptChunk,
  TranscriptSegmentResult,
} from "../types.js";

/**
 * Self-hosted QwenCleo-ASR HTTP adapter (ADR-018).
 *
 * Targets the official FastAPI server from the qwencleo-asr repo:
 *   POST {baseUrl}/v1/transcribe   (multipart: file, language, normalize)
 *   -> {"text": "...", "language": "..."}
 *
 * The server returns text WITHOUT timestamps or diarization, so:
 * - `transcribe()` builds ONE segment spanning the known audio duration
 *   (source timestamps are coarse, segments carry the full utterance).
 * - `transcribeChunked()` is preferred for meetings: the worker pre-cuts the
 *   audio (ffmpeg, 16 kHz mono WAV) and each chunk gets REAL timestamps.
 */
export interface QwenCleoHttpConfig {
  /** Base URL of the ASR server, e.g. http://asr.internal:8000 */
  baseUrl: string;
  /** Optional shared key (`Authorization: Bearer <key>`). */
  apiKey?: string;
  /** Request timeout in ms (transcription of 20 s of audio usually takes <10 s). */
  timeoutMs?: number;
  /** Chunks transcribed at the same time (ADR-024). Default 4. */
  concurrency?: number;
}

/** Server response contract (server/app.py of the qwencleo-asr repository). */
interface QwenCleoResponse {
  text?: string;
  language?: string;
}

const LANGUAGE_HINTS: Record<string, string | undefined> = {
  // QwenCleo is tuned on Egyptian Arabic + Arabic/English code-switching; the
  // model card recommends the "Arabic" hint (or auto-detect via "None").
  ar: "Arabic",
  mixed: "Arabic",
  en: "English",
  auto: "None",
};

export class QwenCleoHttpSpeechToText implements SpeechToText {
  public readonly providerName = "qwencleo-http";
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly concurrency: number;

  constructor(config: QwenCleoHttpConfig) {
    if (!config.baseUrl || config.baseUrl.trim().length === 0) {
      throw new Error(
        "QwenCleoHttpSpeechToText requires baseUrl. Set ASR_HTTP_URL in the environment.",
      );
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey?.trim() || undefined;
    this.timeoutMs = config.timeoutMs ?? 600_000; // 10 min: capped by chunk size
    this.concurrency = Math.min(Math.max(Math.round(config.concurrency ?? 4), 1), 16);
  }

  async transcribe(
    audio: Buffer | Uint8Array | string,
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    const blob = await this.toBlob(audio);
    const data = await this.request([["file", blob, "audio.wav"]], options);

    const durationMs = Math.round((options?.audioDurationSeconds ?? 0) * 1000);
    const text = normalizeCodeSwitchedText(data.text || "");
    const segments: TranscriptSegmentResult[] = [
      {
        id: "seg-1",
        speakerLabel: "Speaker 1",
        startMs: 0,
        endMs: durationMs > 0 ? durationMs : 0,
        text,
      },
    ];

    return {
      text,
      language: data.language || options?.language || "ar",
      durationSeconds: durationMs > 0 ? Math.ceil(durationMs / 1000) : 0,
      segments,
    };
  }

  async transcribeChunked(
    chunks: readonly TranscriptChunk[],
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    // Chunks are independent requests: run a few at once (ADR-024), then merge in order.
    const texts = await mapWithConcurrency(chunks, this.concurrency, async (chunk) => {
      const blob = await this.toBlob(chunkAudio(chunk));
      const data = await this.request([["file", blob, "audio.wav"]], options);
      return normalizeCodeSwitchedText(data.text || "");
    });

    const segments: TranscriptSegmentResult[] = [];
    let previousText = "";
    for (const [index, chunk] of chunks.entries()) {
      const raw = texts[index] ?? "";
      // The lead-in re-transcribes the end of the previous chunk: drop those words.
      const text = chunk.leadInMs && previousText ? removeOverlapPrefix(previousText, raw) : raw;
      previousText = raw;
      if (!text) continue; // silent chunk
      segments.push({
        id: `seg-${segments.length + 1}`,
        speakerLabel: "Speaker 1",
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        text,
      });
    }

    if (segments.length === 0) {
      throw new Error("QwenCleo-ASR chunked transcription produced no text");
    }

    const last = segments[segments.length - 1]!;
    const fullText = segments.map((s) => s.text).join(" ");

    return {
      text: fullText,
      language: options?.language || "ar",
      durationSeconds: Math.ceil(last.endMs / 1000),
      segments,
    };
  }

  private async toBlob(audio: Buffer | Uint8Array | string): Promise<Blob> {
    if (typeof audio === "string") {
      const fs = await import("node:fs/promises");
      const buffer = await fs.readFile(audio);
      return new Blob([buffer], { type: "audio/wav" });
    }
    return new Blob([audio as Uint8Array], { type: "audio/wav" });
  }

  private async request(
    fileField: [[string, Blob, string]],
    options?: TranscribeOptions,
  ): Promise<QwenCleoResponse> {
    const formData = new FormData();
    const [name, blob, filename] = fileField[0]!;
    formData.append(name, blob, filename);
    formData.append("language", LANGUAGE_HINTS[normalizeLanguage(options?.language)] ?? "Arabic");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/transcribe`, {
        method: "POST",
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
        body: formData,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const cause = (err as Error).name === "AbortError" ? "timeout" : (err as Error).message;
      throw new Error(`QwenCleo-ASR request failed (${cause})`);
    }
    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `QwenCleo-ASR transcription failed with HTTP ${response.status}: ${errorText.slice(0, 300)}`,
      );
    }

    return (await response.json()) as QwenCleoResponse;
  }
}

function chunkAudio(chunk: TranscriptChunk): Buffer | Uint8Array | string {
  if (chunk.path) return chunk.path;
  if (chunk.buffer) return chunk.buffer;
  throw new Error("transcript chunk has neither a path nor a buffer");
}

function normalizeLanguage(language?: string): string {
  if (!language) return "auto";
  const lower = language.toLowerCase();
  if (lower.startsWith("ar")) return "ar";
  if (lower.startsWith("en")) return "en";
  if (lower.startsWith("mix")) return "mixed";
  return lower;
}
