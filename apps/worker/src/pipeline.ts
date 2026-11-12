import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { PrismaClient, CreditRepository } from "@dawwen/db";
import {
  saveSegmentEmbedding,
  InsufficientBalanceError,
  MeetingStatus,
  Priority,
  ProposalStatus,
  ProposalActionType,
} from "@dawwen/db";
import type { SpeechToText, TranscribeOptions, TranscriptChunk } from "@dawwen/asr";
import { standardizeArabicTerms } from "@dawwen/asr";
import type { LlmClient, TranscriptContext, EmbeddingClient } from "@dawwen/llm";
import { LlmAnalysisFailedError } from "@dawwen/llm";
import type { PricingConfig } from "@dawwen/config";

type Log = {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

/** The credit operations the pipeline needs (a `CreditRepository` in production). */
export type PipelineCredits = Pick<CreditRepository, "reserveCredits" | "settleCredits">;

export interface PipelineDependencies {
  prisma: PrismaClient;
  s3Client: S3Client;
  asrClient: SpeechToText;
  llmClient: LlmClient;
  pricingConfig: PricingConfig;
  asrProviderName: string;
  llmProviderName: string;
  /**
   * Credit hold + settlement (ADR-023). When omitted, processing is not billed
   * (tests / offline demo); production always wires a `CreditRepository`.
   */
  credits?: PipelineCredits;
  /**
   * Optional audio preparation (16 kHz mono WAV conversion + timed chunk cutting,
   * ADR-018). When it yields chunks and the ASR client supports chunked
   * transcription, per-chunk processing is used so transcript timestamps are real.
   */
  prepareAsrAudio?: (input: Buffer) => Promise<{
    buffer: Buffer;
    durationSeconds?: number;
    chunks?: readonly TranscriptChunk[];
  }>;
  /** Optional embedding generation for semantic (pgvector) search, ADR-016. */
  embeddingClient?: EmbeddingClient;
  logger?: Log;
}

export interface ProcessMeetingParams {
  meetingId: string;
  userId: string;
  s3Bucket: string;
  s3Key: string;
}

export interface PipelineResult {
  meetingId: string;
  /** True when this run did nothing because the meeting was not claimable. */
  skipped: boolean;
  audioDurationSeconds: number;
  segmentsCount: number;
  decisionsCount: number;
  tasksCount: number;
  proposalsCount: number;
  audioDeleted: boolean;
  totalCostMicros: number;
}

/**
 * A failure with a reason that is safe to show the user (stored on the meeting).
 * Never put transcript text in it.
 */
export class PipelineFailure extends Error {
  constructor(public readonly userReason: string) {
    super(userReason);
    this.name = "PipelineFailure";
  }
}

const PROMPT_VERSION = "v1.0.0";
const MAX_REASON_LENGTH = 500;

function failureReasonFor(err: unknown): string {
  if (err instanceof PipelineFailure) return err.userReason;
  const message = err instanceof Error ? err.message : String(err);
  return `Processing failed: ${message}`.slice(0, MAX_REASON_LENGTH);
}

/**
 * Processes one uploaded meeting (ADR-023):
 *
 * 1. **Claim** — `QUEUED → TRANSCRIBING` in one conditional update. A duplicate SQS
 *    delivery or a second worker finds nothing to claim and skips.
 * 2. **Hold credit** for the measured audio length before paying for ASR/LLM.
 * 3. **Clean slate** — partial results of an earlier failed attempt are removed.
 * 4. Transcribe → analyse → persist all results in **one transaction** (which also
 *    moves the meeting to `REVIEW_PENDING`).
 * 5. Settle the hold against the real cost, then delete raw audio per retention.
 *
 * Any failure marks the meeting `FAILED` with a reason, releases the hold and
 * rethrows. Paid provider calls are metered even when the run fails (Invariant 7).
 */
export async function processMeetingAudio(
  deps: PipelineDependencies,
  params: ProcessMeetingParams,
): Promise<PipelineResult> {
  const { prisma } = deps;
  const { meetingId, userId } = params;
  const log: Log = deps.logger ?? { info: () => {}, warn: () => {}, error: () => {} };

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
  if (meeting.userId !== userId) {
    throw new Error(`User ${userId} does not own meeting ${meetingId}`);
  }

  const claim = await prisma.meeting.updateMany({
    where: { id: meetingId, userId, status: MeetingStatus.QUEUED },
    data: { status: MeetingStatus.TRANSCRIBING, failureReason: null },
  });
  if (claim.count === 0) {
    log.info("meeting is not queued; skipping duplicate or stale message", {
      meetingId,
      status: meeting.status,
    });
    return {
      meetingId,
      skipped: true,
      audioDurationSeconds: meeting.audioDurationSeconds ?? 0,
      segmentsCount: 0,
      decisionsCount: 0,
      tasksCount: 0,
      proposalsCount: 0,
      audioDeleted: Boolean(meeting.audioDeletedAt),
      totalCostMicros: 0,
    };
  }

  log.info("claimed meeting for processing", { meetingId, userId });
  const hold = { micros: 0n };

  try {
    return await runClaimedPipeline(
      deps,
      params,
      meeting.title,
      meeting.language,
      meeting.scheduledStart,
      hold,
      log,
    );
  } catch (err) {
    const reason = failureReasonFor(err);
    log.error("meeting processing failed", { meetingId, reason });
    await prisma.meeting
      .updateMany({
        where: {
          id: meetingId,
          status: { in: [MeetingStatus.TRANSCRIBING, MeetingStatus.ANALYZING] },
        },
        data: { status: MeetingStatus.FAILED, failureReason: reason, creditHoldMicros: 0n },
      })
      .catch((e: unknown) =>
        log.error("could not mark meeting FAILED", { meetingId, error: (e as Error).message }),
      );
    if (hold.micros > 0n && deps.credits) {
      await deps.credits
        .settleCredits({ userId }, hold.micros, 0n, "Hold released: processing failed", meetingId)
        .catch((e: unknown) =>
          log.error("could not release credit hold", { meetingId, error: (e as Error).message }),
        );
    }
    throw err;
  }
}

async function runClaimedPipeline(
  deps: PipelineDependencies,
  params: ProcessMeetingParams,
  meetingTitle: string,
  meetingLanguage: string | null,
  scheduledStart: Date | null,
  hold: { micros: bigint },
  log: Log,
): Promise<PipelineResult> {
  const { prisma, s3Client, asrClient, llmClient, pricingConfig } = deps;
  const { asrProviderName, llmProviderName } = deps;
  const { meetingId, userId, s3Bucket, s3Key } = params;

  // Consent gate (Invariant 4).
  const consent = await prisma.recordingConsent.findFirst({ where: { meetingId, userId } });
  if (!consent) {
    throw new PipelineFailure("Consent gate: recording consent not confirmed (Invariant 4)");
  }

  /** Raises the credit hold to `targetMicros` (no-op without billing). */
  const ensureHold = async (targetMicros: bigint): Promise<void> => {
    if (!deps.credits || targetMicros <= hold.micros) return;
    try {
      await deps.credits.reserveCredits(
        { userId },
        targetMicros - hold.micros,
        `Hold for meeting: ${meetingTitle}`,
        meetingId,
      );
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new PipelineFailure(
          "Balance gate: insufficient credit balance for this recording. Please top up your account.",
        );
      }
      throw err;
    }
    hold.micros = targetMicros;
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { creditHoldMicros: hold.micros },
    });
  };
  const priceForMinutes = (minutes: number): bigint =>
    BigInt(pricingConfig.customerPricePerAudioMinuteMicros) * BigInt(minutes);

  // Download audio.
  let audioBuffer: Buffer;
  try {
    const s3Response = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: s3Key }));
    if (!s3Response.Body) throw new Error("empty object body");
    const chunks: Uint8Array[] = [];
    for await (const chunk of s3Response.Body as AsyncIterable<Uint8Array | string>) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    audioBuffer = Buffer.concat(chunks);
  } catch (err) {
    throw new PipelineFailure(`Audio download failed: ${(err as Error).message}`);
  }

  // Prepare audio (ADR-018) and hold credit for the measured length before ASR.
  const prepared = deps.prepareAsrAudio
    ? await deps.prepareAsrAudio(audioBuffer)
    : { buffer: audioBuffer, durationSeconds: undefined, chunks: undefined };
  const measuredMinutes =
    prepared.durationSeconds && prepared.durationSeconds > 0
      ? Math.max(1, Math.ceil(prepared.durationSeconds / 60))
      : 1;
  await ensureHold(priceForMinutes(measuredMinutes));

  // Clean slate: a retry must not duplicate results of an earlier partial run.
  await clearPreviousResults(prisma, meetingId);

  // Speech-to-text.
  const transcribeOptions: TranscribeOptions = {
    language: meetingLanguage || "ar",
    diarize: true,
    audioDurationSeconds: prepared.durationSeconds,
  };
  log.info("running speech-to-text", {
    asrProvider: asrProviderName,
    preparedChunks: prepared.chunks?.length ?? 0,
  });
  const asrResult =
    prepared.chunks && prepared.chunks.length > 1 && asrClient.transcribeChunked
      ? await asrClient.transcribeChunked(prepared.chunks, transcribeOptions)
      : await asrClient.transcribe(prepared.buffer, transcribeOptions);

  // Prefer the measured duration (ffprobe) over provider-reported values.
  const durationSeconds =
    prepared.durationSeconds && prepared.durationSeconds > 0
      ? Math.ceil(prepared.durationSeconds)
      : asrResult.durationSeconds && asrResult.durationSeconds > 0
        ? asrResult.durationSeconds
        : asrResult.segments.length > 0
          ? Math.ceil(Math.max(...asrResult.segments.map((s) => s.endMs)) / 1000)
          : 60;
  const audioMinutes = Math.max(1, Math.ceil(durationSeconds / 60));

  // Meter ASR (Invariant 7) — the provider has been paid whatever happens next.
  const asrCostMicros =
    (pricingConfig.providerCosts.asrPerAudioMinuteMicros[asrProviderName] ?? 0) * audioMinutes;
  const customerPriceMicros = priceForMinutes(audioMinutes);
  await prisma.usageEvent.create({
    data: {
      userId,
      meetingId,
      operationType: "AUDIO_TRANSCRIPTION",
      quantity: audioMinutes,
      unit: "minutes",
      costMicros: BigInt(asrCostMicros),
      metadata: {
        provider: asrProviderName,
        customerPriceMicros: customerPriceMicros.toString(),
        durationSeconds,
      },
    },
  });

  // Provider-reported length can exceed the 1-minute estimate when it was unknown.
  await ensureHold(customerPriceMicros);

  // Save transcript segments (one transaction).
  const createdSegments = await prisma.$transaction(
    asrResult.segments.map((seg) =>
      prisma.transcriptSegment.create({
        data: {
          meetingId,
          speakerLabel: seg.speakerLabel || "Speaker",
          startMs: seg.startMs,
          endMs: seg.endMs,
          text: standardizeArabicTerms(seg.text),
          confidence: seg.confidence ?? 0.95,
          language: asrResult.language || "ar",
        },
        select: { id: true, speakerLabel: true, startMs: true, endMs: true, text: true },
      }),
    ),
  );

  await generateEmbeddings(deps, meetingId, userId, createdSegments, log);

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: MeetingStatus.ANALYZING, audioDurationSeconds: durationSeconds },
  });

  // LLM analysis; failed attempts are metered too.
  log.info("running LLM meeting analysis", { llmProvider: llmProviderName });
  const transcriptContext: TranscriptContext = {
    meetingTitle,
    scheduledStart: scheduledStart ?? undefined,
    language: meetingLanguage || "ar",
    participants: [],
    segments: createdSegments.map((s, idx) => ({
      id: s.id, // Citations MUST map back to real TranscriptSegment ids (Invariant 2)
      speakerLabel: s.speakerLabel || `Speaker ${idx + 1}`,
      text: s.text,
      startMs: s.startMs,
      endMs: s.endMs,
    })),
  };

  const recordLlmUsage = async (
    inputTokens: number,
    outputTokens: number,
    modelName: string,
    failed: boolean,
  ): Promise<number> => {
    const inPerM = pricingConfig.providerCosts.llmPerMillionInputTokensMicros[llmProviderName] ?? 0;
    const outPerM =
      pricingConfig.providerCosts.llmPerMillionOutputTokensMicros[llmProviderName] ?? 0;
    const cost = Math.round((inputTokens * inPerM + outputTokens * outPerM) / 1_000_000);
    await prisma.usageEvent.create({
      data: {
        userId,
        meetingId,
        operationType: "LLM_ANALYSIS",
        quantity: inputTokens + outputTokens,
        unit: "tokens",
        costMicros: BigInt(cost),
        metadata: {
          provider: llmProviderName,
          model: modelName,
          inputTokens,
          outputTokens,
          promptVersion: PROMPT_VERSION,
          ...(failed ? { failed: true } : {}),
        },
      },
    });
    return cost;
  };

  let llmResult;
  try {
    llmResult = await llmClient.analyzeMeeting(transcriptContext);
  } catch (err) {
    if (err instanceof LlmAnalysisFailedError) {
      await recordLlmUsage(err.inputTokens, err.outputTokens, err.modelName, true);
    }
    throw new PipelineFailure(
      `Analysis failed: ${(err as Error).message}`.slice(0, MAX_REASON_LENGTH),
    );
  }
  const llmCostMicros = await recordLlmUsage(
    llmResult.inputTokens,
    llmResult.outputTokens,
    llmResult.modelName,
    false,
  );

  // Persist the whole analysis atomically; the meeting becomes REVIEW_PENDING
  // in the same transaction, so a crash never leaves half an analysis behind.
  const counts = await persistAnalysis(prisma, {
    meetingId,
    userId,
    analysis: llmResult.analysis,
    modelName: llmResult.modelName,
  });

  // Settle: release the hold and charge the real price (capped at the balance).
  if (deps.credits) {
    const total = customerPriceMicros + BigInt(llmCostMicros);
    try {
      const settled = await deps.credits.settleCredits(
        { userId },
        hold.micros,
        total,
        `Usage cost for meeting: ${meetingTitle}`,
        meetingId,
      );
      hold.micros = 0n;
      await prisma.meeting.update({ where: { id: meetingId }, data: { creditHoldMicros: 0n } });
      if (settled.shortfallMicros > 0n) {
        log.warn("meeting usage exceeded available credit; debit was capped", {
          meetingId,
          shortfallMicros: settled.shortfallMicros.toString(),
        });
      }
    } catch (settleErr) {
      // Results are already saved; keep them and leave the hold for an operator.
      hold.micros = 0n;
      log.error("failed to settle credit for meeting", {
        meetingId,
        error: (settleErr as Error).message,
      });
    }
  }

  const audioDeleted = await applyRetention(
    prisma,
    s3Client,
    { meetingId, userId, s3Bucket, s3Key },
    log,
  );

  log.info("meeting pipeline completed", {
    meetingId,
    durationSeconds,
    segments: createdSegments.length,
    ...counts,
    audioDeleted,
  });

  return {
    meetingId,
    skipped: false,
    audioDurationSeconds: durationSeconds,
    segmentsCount: createdSegments.length,
    ...counts,
    audioDeleted,
    totalCostMicros: asrCostMicros + llmCostMicros,
  };
}

/** Removes everything a previous (failed) attempt may have written. */
async function clearPreviousResults(prisma: PrismaClient, meetingId: string): Promise<void> {
  const where = { meetingId };
  await prisma.$transaction([
    prisma.meetingEmbedding.deleteMany({ where }),
    prisma.agendaItem.deleteMany({ where }),
    prisma.topicDiscussion.deleteMany({ where }),
    prisma.decision.deleteMany({ where }),
    prisma.task.deleteMany({ where }),
    prisma.openQuestion.deleteMany({ where }),
    prisma.documentReference.deleteMany({ where }),
    prisma.meetingAnalysis.deleteMany({ where }),
    prisma.proposal.deleteMany({
      where: { meetingId, status: ProposalStatus.PENDING_APPROVAL },
    }),
    prisma.transcriptSegment.deleteMany({ where }),
  ]);
}

async function generateEmbeddings(
  deps: PipelineDependencies,
  meetingId: string,
  userId: string,
  segments: ReadonlyArray<{ id: string; speakerLabel: string | null; text: string }>,
  log: Log,
): Promise<void> {
  const { prisma, embeddingClient, pricingConfig } = deps;
  if (!embeddingClient || segments.length === 0) return;
  try {
    const providerName = embeddingClient.providerName;
    const texts = segments.map((s) => `${s.speakerLabel ?? "Speaker"}: ${s.text}`);
    const vectors = await embeddingClient.embed(texts);
    const tokenEstimate = (text: string) => Math.max(1, Math.ceil(text.length / 4));
    let summedTokens = 0;
    for (let i = 0; i < segments.length && i < vectors.length; i++) {
      const text = texts[i]!;
      summedTokens += tokenEstimate(text);
      await saveSegmentEmbedding(prisma, {
        meetingId,
        segmentId: segments[i]!.id,
        text,
        embedding: vectors[i]!,
        providerName,
        tokenEstimate: tokenEstimate(text),
      });
    }
    const perMillion =
      pricingConfig.providerCosts.embeddingsPerMillionTokensMicros[providerName] ?? 0;
    await prisma.usageEvent.create({
      data: {
        userId,
        meetingId,
        operationType: "EMBEDDING_GENERATION",
        quantity: summedTokens,
        unit: "tokens",
        costMicros: BigInt(Math.round((summedTokens * perMillion) / 1_000_000)),
        metadata: { provider: providerName, segments: segments.length },
      },
    });
  } catch (embedErr) {
    // Semantic search is best-effort: keyword search keeps working without it.
    log.warn("embedding generation failed; semantic search unavailable for this meeting", {
      error: (embedErr as Error).message,
      meetingId,
    });
  }
}

type Analysis = Awaited<ReturnType<LlmClient["analyzeMeeting"]>>["analysis"];

function parsePriority(value: string | null | undefined): Priority {
  const upper = value?.toUpperCase();
  if (upper === "LOW") return Priority.LOW;
  if (upper === "HIGH") return Priority.HIGH;
  return Priority.MEDIUM;
}

async function persistAnalysis(
  prisma: PrismaClient,
  input: { meetingId: string; userId: string; analysis: Analysis; modelName: string },
): Promise<{ decisionsCount: number; tasksCount: number; proposalsCount: number }> {
  const { meetingId, userId, analysis, modelName } = input;
  const decisions = analysis.decisions ?? [];
  const actionItems = analysis.actionItems ?? [];

  await prisma.$transaction(async (tx) => {
    await tx.meetingAnalysis.create({
      data: {
        meetingId,
        tldr: analysis.tldr,
        purpose: analysis.purpose,
        rawJson: JSON.parse(JSON.stringify(analysis)) as object,
        modelName,
        promptVersion: PROMPT_VERSION,
        status: "ready",
      },
    });

    const agenda = (analysis.agenda ?? []).filter((title): title is string => Boolean(title));
    if (agenda.length > 0) {
      await tx.agendaItem.createMany({
        data: agenda.map((title, orderIndex) => ({ meetingId, title, orderIndex })),
      });
    }

    const topics = (analysis.topics ?? []).filter(Boolean);
    if (topics.length > 0) {
      await tx.topicDiscussion.createMany({
        data: topics.map((topic, orderIndex) => ({
          meetingId,
          title: topic.title,
          summary: topic.summary,
          sourceTs: topic.sourceTs || null,
          sourceSegmentIds: topic.sourceSegmentIds || [],
          orderIndex,
        })),
      });
    }

    // Invariant 2: every decision/task carries its source segments.
    if (decisions.length > 0) {
      await tx.decision.createMany({
        data: decisions.map((d) => ({
          meetingId,
          text: d.text,
          sourceTs: d.sourceTs || null,
          sourceSegmentIds: d.sourceSegmentIds || [],
          confidence: null,
          needsReview: d.needsReview ?? false,
          approved: false,
        })),
      });
    }

    // Invariant 3: unknown owner/date stays null and is flagged for review.
    if (actionItems.length > 0) {
      await tx.task.createMany({
        data: actionItems.map((item) => ({
          meetingId,
          title: item.task,
          description: null,
          ownerName: item.owner || null,
          dueDate: item.due ? new Date(item.due) : null,
          priority: parsePriority(item.priority),
          sourceTs: item.sourceTs || null,
          sourceSegmentIds: item.sourceSegmentIds || [],
          needsReview: !item.owner || !item.due ? true : Boolean(item.needsReview),
          approved: false,
        })),
      });
    }

    if (analysis.openQuestions && analysis.openQuestions.length > 0) {
      await tx.openQuestion.createMany({
        data: analysis.openQuestions.map((question) => ({
          meetingId,
          question,
          askedBy: null,
          sourceTs: null,
          sourceSegmentIds: [],
        })),
      });
    }

    if (analysis.documents && analysis.documents.length > 0) {
      await tx.documentReference.createMany({
        data: analysis.documents.map((title) => ({ meetingId, title, url: "" })),
      });
    }

    // Invariant 1: the AI only proposes; a human approves before anything happens.
    if (analysis.nextMeeting) {
      await tx.proposal.create({
        data: {
          userId,
          meetingId,
          actionType: ProposalActionType.SCHEDULE_MEETING,
          payload: JSON.parse(JSON.stringify(analysis.nextMeeting)) as object,
          status: ProposalStatus.PENDING_APPROVAL,
          reason: "Follow-up meeting proposed by AI analysis",
        },
      });
    }

    await tx.meeting.update({
      where: { id: meetingId },
      data: { status: MeetingStatus.REVIEW_PENDING, actualEnd: new Date() },
    });
  });

  return {
    decisionsCount: decisions.length,
    tasksCount: actionItems.length,
    proposalsCount: analysis.nextMeeting ? 1 : 0,
  };
}

/** Invariant 5: raw audio is deleted right away unless the user chose to keep it. */
async function applyRetention(
  prisma: PrismaClient,
  s3Client: S3Client,
  params: ProcessMeetingParams,
  log: Log,
): Promise<boolean> {
  const { meetingId, userId, s3Bucket, s3Key } = params;
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if ((settings?.audioRetentionDays ?? 0) > 0) return false; // S3 lifecycle deletes it later

  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: s3Key }));
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { audioDeletedAt: new Date() },
    });
    return true;
  } catch (delErr) {
    log.warn("failed to delete raw audio from S3", { error: (delErr as Error).message, meetingId });
    return false;
  }
}
