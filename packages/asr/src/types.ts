export interface TranscribeOptions {
  language?: string;
  diarize?: boolean;
  numSpeakers?: number;
  /** Total audio duration (seconds) when known (e.g. from ffprobe) — used by
   * providers that return no timestamps to build a full-length segment. */
  audioDurationSeconds?: number;
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
  /**
   * Optional chunked transcription for self-hosted servers that return text only
   * (e.g. the QwenCleo FastAPI server): the worker splits long audio into timed
   * chunks; the adapter transcribes each and merges them into real timestamps.
   */
  transcribeChunked?(
    chunks: readonly TranscriptChunk[],
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult>;
}

/** One pre-cut piece of audio with its position in the original recording. */
export interface TranscriptChunk {
  buffer: Buffer | Uint8Array;
  startMs: number;
  endMs: number;
}
