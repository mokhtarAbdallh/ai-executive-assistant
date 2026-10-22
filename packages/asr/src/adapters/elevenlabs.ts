import { normalizeCodeSwitchedText } from "../post-processor.js";
import type {
  SpeechToText,
  TranscribeOptions,
  TranscriptionResult,
  TranscriptSegmentResult,
  TranscriptWord,
} from "../types.js";

export interface ElevenLabsConfig {
  apiKey: string;
  baseUrl?: string;
  modelId?: string;
}

interface ElevenLabsWord {
  text: string;
  start: number; // seconds
  end: number; // seconds
  type?: string;
  speaker_id?: string;
}

interface ElevenLabsResponse {
  text: string;
  words?: ElevenLabsWord[];
  language_code?: string;
}

export class ElevenLabsSpeechToText implements SpeechToText {
  public readonly providerName = "elevenlabs";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelId: string;

  constructor(config: ElevenLabsConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error(
        "ElevenLabsSpeechToText requires a valid apiKey. Set ELEVENLABS_API_KEY in environment or use fake provider in demo mode.",
      );
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = config.baseUrl ?? "https://api.elevenlabs.io/v1/speech-to-text";
    this.modelId = config.modelId ?? "scribe_v1";
  }

  async transcribe(
    audio: Buffer | Uint8Array | string,
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    const formData = new FormData();

    let audioBlob: Blob;
    if (typeof audio === "string") {
      // Audio path or URL: read into Buffer
      const fs = await import("node:fs/promises");
      const buffer = await fs.readFile(audio);
      audioBlob = new Blob([buffer], { type: "audio/wav" });
    } else {
      audioBlob = new Blob([audio], { type: "audio/wav" });
    }

    formData.append("file", audioBlob, "audio.wav");
    formData.append("model_id", this.modelId);
    formData.append("diarize", options?.diarize !== false ? "true" : "false");
    formData.append("tag_audio_events", "false");

    if (options?.language) {
      formData.append("language_code", options.language);
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ElevenLabs Scribe transcription failed with HTTP ${response.status}: ${errorText}`,
      );
    }

    const data = (await response.json()) as ElevenLabsResponse;
    const words = data.words ?? [];

    const segments: TranscriptSegmentResult[] = [];
    let currentSpeaker = "";
    let currentWords: TranscriptWord[] = [];
    let segStart = 0;
    let segEnd = 0;

    for (const w of words) {
      const speaker = w.speaker_id || "Speaker 1";
      const startMs = Math.round(w.start * 1000);
      const endMs = Math.round(w.end * 1000);

      if (currentSpeaker && speaker !== currentSpeaker) {
        // Flush segment
        const segText = currentWords.map((cw) => cw.text).join(" ");
        segments.push({
          id: `seg-${segments.length + 1}`,
          speakerLabel: currentSpeaker,
          startMs: segStart,
          endMs: segEnd,
          text: normalizeCodeSwitchedText(segText),
          words: currentWords,
        });
        currentWords = [];
      }

      if (currentWords.length === 0) {
        currentSpeaker = speaker;
        segStart = startMs;
      }

      segEnd = endMs;
      currentWords.push({
        text: w.text,
        startMs,
        endMs,
        speaker,
      });
    }

    // Flush last segment
    if (currentWords.length > 0) {
      const segText = currentWords.map((cw) => cw.text).join(" ");
      segments.push({
        id: `seg-${segments.length + 1}`,
        speakerLabel: currentSpeaker || "Speaker 1",
        startMs: segStart,
        endMs: segEnd,
        text: normalizeCodeSwitchedText(segText),
        words: currentWords,
      });
    }

    const lastSeg = segments[segments.length - 1];
    const durationSeconds =
      lastSeg ? Math.ceil(lastSeg.endMs / 1000) : 0;

    const fullNormalizedText = normalizeCodeSwitchedText(
      data.text || segments.map((s) => s.text).join(" "),
    );

    return {
      text: fullNormalizedText,
      language: data.language_code || options?.language || "ar",
      durationSeconds,
      segments,
    };
  }
}
