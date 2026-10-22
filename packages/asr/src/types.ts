export interface TranscribeOptions {
  language?: string;
  diarize?: boolean;
  numSpeakers?: number;
}

export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  speaker?: string;
}

export interface TranscriptSegmentResult {
  id?: string;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  words?: TranscriptWord[];
}

export interface TranscriptionResult {
  text: string;
  language: string;
  durationSeconds: number;
  segments: TranscriptSegmentResult[];
}

export interface SpeechToText {
  readonly providerName: string;
  transcribe(
    audio: Buffer | Uint8Array | string,
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult>;
}
