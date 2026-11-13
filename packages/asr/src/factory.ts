import { FakeSpeechToText } from "./adapters/fake.js";
import { ElevenLabsSpeechToText, type ElevenLabsConfig } from "./adapters/elevenlabs.js";
import { QwenCleoHttpSpeechToText, type QwenCleoHttpConfig } from "./adapters/qwencleo.js";
import { OpenAiWhisperSpeechToText } from "./adapters/openai-whisper.js";
import {
  SpeechmaticsSpeechToText,
  WhisperSpeechToText,
  AmazonTranscribeSpeechToText,
} from "./adapters/stubs.js";
import type { SpeechToText } from "./types.js";

export interface CreateAsrOptions {
  provider?: string;
  elevenlabs?: ElevenLabsConfig;
  http?: QwenCleoHttpConfig & { model?: string };
}

export function createSpeechToText(options?: CreateAsrOptions): SpeechToText {
  const provider = (options?.provider || process.env.ASR_PROVIDER || "fake").toLowerCase();

  switch (provider) {
    case "elevenlabs": {
      const apiKey = options?.elevenlabs?.apiKey || process.env.ELEVENLABS_API_KEY || "";
      return new ElevenLabsSpeechToText({ apiKey });
    }
    case "speechmatics":
      return new SpeechmaticsSpeechToText();
    case "qwencleo-http":
      return new QwenCleoHttpSpeechToText({
        baseUrl: options?.http?.baseUrl || process.env.ASR_HTTP_URL || "",
        apiKey: options?.http?.apiKey || process.env.ASR_HTTP_API_KEY,
        timeoutMs: options?.http?.timeoutMs,
        concurrency: options?.http?.concurrency,
      });
    case "openai-whisper":
      // ADR-026: Groq / OpenAI audio API (free tier on the Learner Lab).
      return new OpenAiWhisperSpeechToText({
        baseUrl: options?.http?.baseUrl || process.env.ASR_HTTP_URL || "",
        apiKey: options?.http?.apiKey || process.env.ASR_HTTP_API_KEY,
        model: options?.http?.model || process.env.ASR_MODEL,
        timeoutMs: options?.http?.timeoutMs,
        concurrency: options?.http?.concurrency,
      });
    case "whisper-http":
    case "whisper":
      return new WhisperSpeechToText();
    case "transcribe":
      return new AmazonTranscribeSpeechToText();
    case "fake":
    default:
      return new FakeSpeechToText();
  }
}
