import { FakeSpeechToText } from "./adapters/fake.js";
import { ElevenLabsSpeechToText, type ElevenLabsConfig } from "./adapters/elevenlabs.js";
import {
  SpeechmaticsSpeechToText,
  WhisperSpeechToText,
  AmazonTranscribeSpeechToText,
} from "./adapters/stubs.js";
import type { SpeechToText } from "./types.js";

export interface CreateAsrOptions {
  provider?: string;
  elevenlabs?: ElevenLabsConfig;
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
