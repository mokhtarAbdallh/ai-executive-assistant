import { normalizeCodeSwitchedText } from "../post-processor.js";
import { mapWithConcurrency } from "../chunking.js";
import type {
  SpeechToText,
  TranscribeOptions,
  TranscriptChunk,
  TranscriptionResult,
  TranscriptSegmentResult,
} from "../types.js";

/**
 * OpenAI-compatible Whisper adapter (ADR-026, Learner Lab / free tier).
 *
 *   POST {baseUrl}/audio/transcriptions   (multipart: file, model, language,
 *        response_format=verbose_json)  -> { text, segments: [{start, end, text, no_speech_prob}] }
 *
 * Works with Groq (https://api.groq.com/openai/v1, whisper-large-v3) and any server that
 * speaks the OpenAI audio API. Whisper does not diarize: every segment is "Speaker 1".
 * Segment timestamps are real (seconds inside each chunk), so citations point at
 * sentences, not whole chunks.
 */
export interface OpenAiWhisperConfig {
  /** e.g. https://api.groq.com/openai/v1 */
  baseUrl: string;
  apiKey?: string;
  /** e.g. whisper-large-v3 (Groq) or whisper-1 (OpenAI). */
  model?: string;
  timeoutMs?: number;
  /** Chunks in flight at once. Free tiers limit requests per minute: keep it low. */
  concurrency?: number;
  /** Retries on 429/5xx (honours Retry-After). */
  maxRetries?: number;
  /** Segments the model marks as probably silence are dropped (Whisper invents text there). */
  noSpeechThreshold?: number;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
}

interface WhisperResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: WhisperSegment[];
}

export class OpenAiWhisperSpeechToText implements SpeechToText {
  public readonly providerName = "openai-whisper";
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly noSpeechThreshold: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: OpenAiWhisperConfig) {
    if (!config.baseUrl?.trim()) {
      throw new Error("OpenAiWhisperSpeechToText requires baseUrl. Set ASR_HTTP_URL.");
    }
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    this.apiKey = config.apiKey?.trim() || undefined;
    this.model = config.model?.trim() || "whisper-large-v3";
    this.timeoutMs = config.timeoutMs ?? 300_000;
    this.concurrency = Math.min(Math.max(Math.round(config.concurrency ?? 2), 1), 8);
    this.maxRetries = config.maxRetries ?? 5;
    this.noSpeechThreshold = config.noSpeechThreshold ?? 0.6;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async transcribe(
    audio: Buffer | Uint8Array | string,
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    return this.transcribeChunked([{ ...toChunkAudio(audio), startMs: 0, endMs: 0 }], options);
  }

  async transcribeChunked(
    chunks: readonly TranscriptChunk[],
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    const responses = await mapWithConcurrency(chunks, this.concurrency, (chunk) =>
      this.request(chunk, options),
    );

    const segments: TranscriptSegmentResult[] = [];
    let endMs = 0;
    for (const [index, chunk] of chunks.entries()) {
      const data = responses[index] ?? {};
      // The chunk file starts leadInMs before chunk.startMs (overlap with the previous one).
      const offsetMs = chunk.startMs - (chunk.leadInMs ?? 0);
      const pieces = data.segments?.length
        ? data.segments
        : [{ start: 0, end: data.duration ?? 0, text: data.text ?? "" }];

      for (const piece of pieces) {
        if ((piece.no_speech_prob ?? 0) > this.noSpeechThreshold) continue;
        const start = offsetMs + Math.round(piece.start * 1000);
        const end = offsetMs + Math.round(piece.end * 1000);
        // Words heard in the lead-in were already transcribed by the previous chunk.
        if (chunk.leadInMs && (start + end) / 2 < chunk.startMs) continue;
        const text = normalizeCodeSwitchedText(piece.text.trim());
        if (!text) continue;
        const segStart = Math.max(start, chunk.startMs);
        const segEnd = Math.max(end, segStart);
        segments.push({
          id: `seg-${segments.length + 1}`,
          speakerLabel: "Speaker 1",
          startMs: segStart,
          endMs: segEnd,
          text,
        });
      }
      endMs = Math.max(endMs, chunk.endMs, offsetMs + Math.round((data.duration ?? 0) * 1000));
    }

    if (segments.length === 0) {
      throw new Error("Whisper transcription produced no text (silent or unreadable audio)");
    }

    return {
      text: segments.map((s) => s.text).join(" "),
      language: responses.find((r) => r?.language)?.language ?? options?.language ?? "ar",
      durationSeconds: Math.ceil(
        Math.max(
          endMs,
          segments[segments.length - 1]!.endMs,
          (options?.audioDurationSeconds ?? 0) * 1000,
        ) / 1000,
      ),
      segments,
    };
  }

  private async request(
    chunk: TranscriptChunk,
    options?: TranscribeOptions,
  ): Promise<WhisperResponse> {
    const audio = await readAudio(chunk);
    for (let attempt = 0; ; attempt++) {
      const form = new FormData();
      form.append("file", new Blob([audio as Uint8Array], { type: "audio/wav" }), "audio.wav");
      form.append("model", this.model);
      form.append("response_format", "verbose_json");
      form.append("temperature", "0");
      const language = whisperLanguage(options?.language);
      if (language) form.append("language", language);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
          body: form,
          signal: controller.signal,
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        const cause = (err as Error).name === "AbortError" ? "timeout" : (err as Error).message;
        throw new Error(`Whisper request failed (${cause})`);
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) return (await response.json()) as WhisperResponse;

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await this.sleep(retryAfterMs(response) ?? backoffMs(attempt));
        continue;
      }
      // Provider error bodies describe the request, never the audio content.
      const body = (await response.text()).slice(0, 300);
      throw new Error(`Whisper transcription failed with HTTP ${response.status}: ${body}`);
    }
  }
}

function toChunkAudio(
  audio: Buffer | Uint8Array | string,
): Pick<TranscriptChunk, "path" | "buffer"> {
  return typeof audio === "string" ? { path: audio } : { buffer: audio };
}

async function readAudio(chunk: TranscriptChunk): Promise<Uint8Array> {
  if (chunk.buffer) return chunk.buffer;
  if (chunk.path) {
    const fs = await import("node:fs/promises");
    return fs.readFile(chunk.path);
  }
  throw new Error("transcript chunk has neither a path nor a buffer");
}

/** Whisper wants ISO-639-1; code-switched Egyptian meetings are transcribed as Arabic. */
function whisperLanguage(language?: string): string | undefined {
  const lower = language?.toLowerCase() ?? "";
  if (lower.startsWith("ar") || lower.startsWith("mix")) return "ar";
  if (lower.startsWith("en")) return "en";
  return undefined; // auto-detect
}

function retryAfterMs(response: Response): number | undefined {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.min(value, 120) * 1000 : undefined;
}

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 2000, 60_000);
}
