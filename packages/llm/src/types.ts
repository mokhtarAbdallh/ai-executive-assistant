import type { MeetingAnalysis } from "@dawwen/shared";

export interface TranscriptSegmentInput {
  id: string;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptContext {
  meetingTitle?: string;
  scheduledStart?: Date;
  language?: string;
  participants?: string[];
  segments: TranscriptSegmentInput[];
}

export interface LlmAnalysisResult {
  analysis: MeetingAnalysis;
  inputTokens: number;
  outputTokens: number;
  modelName: string;
}

export interface LlmClient {
  readonly providerName: string;
  analyzeMeeting(context: TranscriptContext): Promise<LlmAnalysisResult>;
}

/** Text embedding contract used by semantic search (pgvector). */
export interface EmbeddingClient {
  readonly providerName: string;
  /** Embeds a batch of texts; mirrors input order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

/**
 * Thrown when analysis ultimately fails. Carries the tokens already consumed so the
 * caller can still meter the real cost (Invariant 7).
 */
export class LlmAnalysisFailedError extends Error {
  constructor(
    message: string,
    public readonly inputTokens: number,
    public readonly outputTokens: number,
    public readonly modelName: string,
  ) {
    super(message);
    this.name = "LlmAnalysisFailedError";
  }
}
