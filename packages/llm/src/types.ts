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
