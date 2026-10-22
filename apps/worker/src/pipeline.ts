import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@dawwen/db";
import {
  MeetingStatus,
  Priority,
  ProposalStatus,
  ProposalActionType,
} from "@dawwen/db";
import type { SpeechToText } from "@dawwen/asr";
import { standardizeArabicTerms } from "@dawwen/asr";
import type { LlmClient, TranscriptContext } from "@dawwen/llm";
import type { PricingConfig } from "@dawwen/config";

export interface PipelineDependencies {
  prisma: PrismaClient;
  s3Client: S3Client;
  asrClient: SpeechToText;
  llmClient: LlmClient;
  pricingConfig: PricingConfig;
  asrProviderName: string;
  llmProviderName: string;
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export interface ProcessMeetingParams {
  meetingId: string;
  userId: string;
  s3Bucket: string;
  s3Key: string;
}

export interface PipelineResult {
  meetingId: string;
  audioDurationSeconds: number;
  segmentsCount: number;
  decisionsCount: number;
  tasksCount: number;
  proposalsCount: number;
  audioDeleted: boolean;
  totalCostMicros: number;
}

export async function processMeetingAudio(
  deps: PipelineDependencies,
  params: ProcessMeetingParams,
): Promise<PipelineResult> {
  const { prisma, s3Client, asrClient, llmClient, pricingConfig, asrProviderName, llmProviderName } = deps;
  const { meetingId, userId, s3Bucket, s3Key } = params;
  const log = deps.logger ?? {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  log.info("starting pipeline for meeting", { meetingId, userId, s3Key });

  // 1. Verify meeting exists and belongs to user
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { user: true },
  });

  if (!meeting) {
    throw new Error(`Meeting not found: ${meetingId}`);
  }

  if (meeting.userId !== userId) {
    throw new Error(`User ${userId} does not own meeting ${meetingId}`);
  }

  // Idempotency: if already completed or analyzing with existing results, avoid duplicate work
  if (meeting.status === MeetingStatus.APPROVED || meeting.status === MeetingStatus.REVIEW_PENDING) {
    log.info("meeting already processed, skipping", { meetingId, status: meeting.status });
    return {
      meetingId,
      audioDurationSeconds: meeting.audioDurationSeconds ?? 0,
      segmentsCount: 0,
      decisionsCount: 0,
      tasksCount: 0,
      proposalsCount: 0,
      audioDeleted: Boolean(meeting.audioDeletedAt),
      totalCostMicros: 0,
    };
  }

  // 2. Consent Gate (Hard Invariant 4)
  // A meeting cannot be processed until recording consent is confirmed.
  const consent = await prisma.recordingConsent.findFirst({
    where: { meetingId, userId },
  });

  if (!consent) {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: MeetingStatus.FAILED,
        failureReason: "Consent gate: recording consent not confirmed (Invariant 4)",
      },
    });
    throw new Error(
      `Invariant 4: A meeting cannot be processed until recording consent is confirmed (meeting: ${meetingId})`,
    );
  }

  // Update status to TRANSCRIBING
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: MeetingStatus.TRANSCRIBING },
  });

  // 3. Download audio from S3
  let audioBuffer: Buffer;
  try {
    const s3Response = await s3Client.send(
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      }),
    );

    if (!s3Response.Body) {
      throw new Error(`Empty audio body from S3: s3://${s3Bucket}/${s3Key}`);
    }

    const streamToBuffer = async (
      stream: AsyncIterable<Uint8Array | string>,
    ): Promise<Buffer> => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks);
    };

    audioBuffer = await streamToBuffer(
      s3Response.Body as AsyncIterable<Uint8Array | string>,
    );
  } catch (err) {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: MeetingStatus.FAILED,
        failureReason: `Audio download failed: ${(err as Error).message}`,
      },
    });
    throw err;
  }

  // 4. ASR Transcription
  log.info("running speech-to-text", { asrProvider: asrProviderName, bufferSize: audioBuffer.length });

  const asrResult = await asrClient.transcribe(audioBuffer, {
    language: meeting.language || "ar",
    diarize: true,
  });

  // Compute audio duration (seconds)
  const durationSeconds =
    asrResult.durationSeconds && asrResult.durationSeconds > 0
      ? asrResult.durationSeconds
      : asrResult.segments.length > 0
        ? Math.ceil(Math.max(...asrResult.segments.map((s) => s.endMs)) / 1000)
        : 60; // minimum 1 minute

  const audioMinutes = Math.max(1, Math.ceil(durationSeconds / 60));

  // 5. Save Transcript Segments into DB with Arabic/English technical term normalization
  const createdSegments: Array<{
    id: string;
    speakerLabel: string | null;
    startMs: number;
    endMs: number;
    text: string;
  }> = [];

  for (const seg of asrResult.segments) {
    const standardizedText = standardizeArabicTerms(seg.text);
    const dbSeg = await prisma.transcriptSegment.create({
      data: {
        meetingId,
        speakerLabel: seg.speakerLabel || "Speaker",
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: standardizedText,
        confidence: seg.confidence ?? 0.95,
        language: asrResult.language || "ar",
      },
      select: {
        id: true,
        speakerLabel: true,
        startMs: true,
        endMs: true,
        text: true,
      },
    });
    createdSegments.push(dbSeg);
  }

  // 6. Record ASR Usage Event (Hard Invariant 7)
  const asrCostPerMinute =
    pricingConfig.providerCosts.asrPerAudioMinuteMicros[asrProviderName] ?? 0;
  const asrCostMicros = asrCostPerMinute * audioMinutes;
  const customerPriceMicros =
    pricingConfig.customerPricePerAudioMinuteMicros * audioMinutes;

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
        customerPriceMicros,
        durationSeconds,
      },
    },
  });

  // Update status to ANALYZING
  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: MeetingStatus.ANALYZING,
      audioDurationSeconds: durationSeconds,
    },
  });

  // 7. LLM Meeting Analysis
  log.info("running LLM meeting analysis", { llmProvider: llmProviderName });
  const transcriptContext: TranscriptContext = {
    meetingTitle: meeting.title,
    scheduledStart: meeting.scheduledStart ?? undefined,
    language: meeting.language || "ar",
    participants: [],
    segments: createdSegments.map((s, idx) => ({
      id: s.id, // Citations MUST map back to real TranscriptSegment ids (Invariant 2)
      speakerLabel: s.speakerLabel || `Speaker ${idx + 1}`,
      text: s.text,
      startMs: s.startMs,
      endMs: s.endMs,
    })),
  };

  const llmResult = await llmClient.analyzeMeeting(transcriptContext);
  const analysis = llmResult.analysis;

  // 8. Record LLM Usage Event (Hard Invariant 7)
  const inputCostPerMillion =
    pricingConfig.providerCosts.llmPerMillionInputTokensMicros[llmProviderName] ?? 0;
  const outputCostPerMillion =
    pricingConfig.providerCosts.llmPerMillionOutputTokensMicros[llmProviderName] ?? 0;

  const inputCostMicros = Math.round(
    (llmResult.inputTokens * inputCostPerMillion) / 1_000_000,
  );
  const outputCostMicros = Math.round(
    (llmResult.outputTokens * outputCostPerMillion) / 1_000_000,
  );
  const totalLlmCostMicros = inputCostMicros + outputCostMicros;

  await prisma.usageEvent.create({
    data: {
      userId,
      meetingId,
      operationType: "LLM_ANALYSIS",
      quantity: llmResult.inputTokens + llmResult.outputTokens,
      unit: "tokens",
      costMicros: BigInt(totalLlmCostMicros),
      metadata: {
        provider: llmProviderName,
        model: llmResult.modelName,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        promptVersion: "v1.0.0",
      },
    },
  });

  // 9. Persist Meeting Analysis in DB
  const analysisJson = JSON.parse(JSON.stringify(analysis)) as object;

  await prisma.meetingAnalysis.upsert({
    where: { meetingId },
    update: {
      tldr: analysis.tldr,
      purpose: analysis.purpose,
      rawJson: analysisJson,
      modelName: llmResult.modelName,
      promptVersion: "v1.0.0",
      status: "ready",
    },
    create: {
      meetingId,
      tldr: analysis.tldr,
      purpose: analysis.purpose,
      rawJson: analysisJson,
      modelName: llmResult.modelName,
      promptVersion: "v1.0.0",
      status: "ready",
    },
  });

  // Persist Agenda Items
  if (analysis.agenda && analysis.agenda.length > 0) {
    for (let i = 0; i < analysis.agenda.length; i++) {
      const title = analysis.agenda[i];
      if (!title) continue;
      await prisma.agendaItem.create({
        data: {
          meetingId,
          title,
          orderIndex: i,
        },
      });
    }
  }

  // Persist Topic Discussions
  if (analysis.topics && analysis.topics.length > 0) {
    for (let i = 0; i < analysis.topics.length; i++) {
      const topic = analysis.topics[i];
      if (!topic) continue;
      await prisma.topicDiscussion.create({
        data: {
          meetingId,
          title: topic.title,
          summary: topic.summary,
          sourceTs: topic.sourceTs || null,
          sourceSegmentIds: topic.sourceSegmentIds || [],
          orderIndex: i,
        },
      });
    }
  }

  // Persist Decisions (Hard Invariant 2: source segment citations)
  let decisionsCount = 0;
  if (analysis.decisions && analysis.decisions.length > 0) {
    for (const d of analysis.decisions) {
      await prisma.decision.create({
        data: {
          meetingId,
          text: d.text,
          sourceTs: d.sourceTs || null,
          sourceSegmentIds: d.sourceSegmentIds || [],
          confidence: null,
          needsReview: d.needsReview ?? false,
          approved: false,
        },
      });
      decisionsCount++;
    }
  }

  // Persist Tasks / Action Items (Hard Invariants 2 & 3: citations, no fabrication)
  let tasksCount = 0;
  if (analysis.actionItems && analysis.actionItems.length > 0) {
    for (const item of analysis.actionItems) {
      // Invariant 3: unknown owner/date stays null and is flagged needsReview
      const isMissingOwnerOrDate = !item.owner || !item.due;
      const needsReview = isMissingOwnerOrDate ? true : Boolean(item.needsReview);

      let parsedPriority: Priority = Priority.MEDIUM;
      if (item.priority) {
        const pUpper = item.priority.toUpperCase();
        if (pUpper === "LOW") parsedPriority = Priority.LOW;
        if (pUpper === "HIGH") parsedPriority = Priority.HIGH;
      }

      await prisma.task.create({
        data: {
          meetingId,
          title: item.task,
          description: null,
          ownerName: item.owner || null,
          dueDate: item.due ? new Date(item.due) : null,
          priority: parsedPriority,
          sourceTs: item.sourceTs || null,
          sourceSegmentIds: item.sourceSegmentIds || [],
          needsReview,
          approved: false,
        },
      });
      tasksCount++;
    }
  }

  // Persist Open Questions
  if (analysis.openQuestions && analysis.openQuestions.length > 0) {
    for (const q of analysis.openQuestions) {
      await prisma.openQuestion.create({
        data: {
          meetingId,
          question: q,
          askedBy: null,
          sourceTs: null,
          sourceSegmentIds: [],
        },
      });
    }
  }

  // Persist Document References
  if (analysis.documents && analysis.documents.length > 0) {
    for (const doc of analysis.documents) {
      await prisma.documentReference.create({
        data: {
          meetingId,
          title: doc,
          url: "",
        },
      });
    }
  }

  // 10. Human-in-the-loop: Next Meeting Proposal (Hard Invariant 1)
  // AI may ONLY create proposals; side effects require human approval.
  let proposalsCount = 0;
  if (analysis.nextMeeting) {
    await prisma.proposal.create({
      data: {
        userId,
        meetingId,
        actionType: ProposalActionType.SCHEDULE_MEETING,
        payload: JSON.parse(JSON.stringify(analysis.nextMeeting)) as object,
        status: ProposalStatus.PENDING_APPROVAL,
        reason: "Follow-up meeting proposed by AI analysis",
      },
    });
    proposalsCount++;
  }

  // 11. Privacy & Retention Deletion (Hard Invariant 5)
  // Raw audio is deleted after transcription (default or by retention policy)
  const userSettings = await prisma.userSettings.findUnique({
    where: { userId },
  });

  const retentionDays = userSettings?.audioRetentionDays ?? 0;
  let audioDeleted = false;

  // If retention is 0 (or default policy), delete immediately from S3
  if (retentionDays === 0) {
    log.info("privacy retention: deleting raw audio from S3", { s3Bucket, s3Key });
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: s3Bucket,
          Key: s3Key,
        }),
      );
      audioDeleted = true;
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { audioDeletedAt: new Date() },
      });
    } catch (delErr) {
      log.warn("failed to delete raw audio from S3", {
        error: (delErr as Error).message,
        s3Key,
      });
    }
  }

  // 12. Finalize Meeting Status
  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: MeetingStatus.REVIEW_PENDING,
      actualEnd: new Date(),
    },
  });

  log.info("meeting pipeline completed successfully", {
    meetingId,
    durationSeconds,
    segments: createdSegments.length,
    decisionsCount,
    tasksCount,
    proposalsCount,
    audioDeleted,
  });

  return {
    meetingId,
    audioDurationSeconds: durationSeconds,
    segmentsCount: createdSegments.length,
    decisionsCount,
    tasksCount,
    proposalsCount,
    audioDeleted,
    totalCostMicros: asrCostMicros + totalLlmCostMicros,
  };
}
