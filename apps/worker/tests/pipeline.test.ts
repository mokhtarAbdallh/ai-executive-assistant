import { describe, it, expect, vi, beforeEach } from "vitest";
import { processMeetingAudio, type PipelineDependencies } from "../src/pipeline.js";
import { FakeSpeechToText } from "@dawwen/asr";
import { FakeLlmClient } from "@dawwen/llm";
import {
  MeetingStatus,
  ProposalActionType,
  ProposalStatus,
} from "@dawwen/db";

describe("Worker Pipeline (@dawwen/worker)", () => {
  const userId = "user-pipeline-test";
  const meetingId = "meet-pipeline-test";
  const s3Bucket = "test-audio-bucket";
  const s3Key = `uploads/${userId}/${meetingId}/sample-audio.mp3`;

  let mockDb: {
    meeting: any;
    userSettings: any;
    recordingConsent: any;
    transcriptSegment: any;
    meetingAnalysis: any;
    agendaItem: any;
    topicDiscussion: any;
    decision: any;
    task: any;
    openQuestion: any;
    documentReference: any;
    proposal: any;
    usageEvent: any;
  };

  let mockS3: any;
  let pipelineDeps: PipelineDependencies;

  const mockPricing = {
    customerPricePerAudioMinuteMicros: 20000,
    providerCosts: {
      asrPerAudioMinuteMicros: { fake: 0, elevenlabs: 5000 },
      llmPerMillionInputTokensMicros: { fake: 0, bedrock: 3000000 },
      llmPerMillionOutputTokensMicros: { fake: 0, bedrock: 15000000 },
      embeddingsPerMillionTokensMicros: { fake: 0, bedrock: 100000 },
    },
    lowBalanceThresholdMicros: 1000000,
  };

  beforeEach(() => {
    // In-memory mock tables
    const segmentsStore: any[] = [];
    const decisionsStore: any[] = [];
    const tasksStore: any[] = [];
    const proposalsStore: any[] = [];
    const usageEventsStore: any[] = [];
    let meetingStatus = MeetingStatus.QUEUED;
    let audioDeletedAt: Date | null = null;
    let failureReason: string | null = null;

    mockDb = {
      meeting: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === meetingId) {
            return Promise.resolve({
              id: meetingId,
              userId,
              title: "Sprint Review & Planning",
              status: meetingStatus,
              language: "ar",
              audioS3Key: s3Key,
              audioDurationSeconds: null,
              audioDeletedAt,
              failureReason,
            });
          }
          return Promise.resolve(null);
        }),
        update: vi.fn().mockImplementation(({ data }: { data: any }) => {
          if (data.status) meetingStatus = data.status;
          if (data.audioDeletedAt) audioDeletedAt = data.audioDeletedAt;
          if (data.failureReason) failureReason = data.failureReason;
          return Promise.resolve({ id: meetingId, status: meetingStatus });
        }),
      },
      userSettings: {
        findUnique: vi.fn().mockResolvedValue({
          userId,
          audioRetentionDays: 0, // Invariant 5 default: immediate deletion
        }),
      },
      recordingConsent: {
        findFirst: vi.fn().mockResolvedValue({
          id: "consent-1",
          userId,
          meetingId,
          participantName: "Test Participant",
        }),
      },
      transcriptSegment: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `seg-${segmentsStore.length + 1}`, ...data };
          segmentsStore.push(item);
          return Promise.resolve(item);
        }),
      },
      meetingAnalysis: {
        upsert: vi.fn().mockResolvedValue({ id: "analysis-1", meetingId }),
      },
      agendaItem: {
        create: vi.fn().mockResolvedValue({ id: "agenda-1" }),
      },
      topicDiscussion: {
        create: vi.fn().mockResolvedValue({ id: "topic-1" }),
      },
      decision: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `dec-${decisionsStore.length + 1}`, ...data };
          decisionsStore.push(item);
          return Promise.resolve(item);
        }),
      },
      task: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `task-${tasksStore.length + 1}`, ...data };
          tasksStore.push(item);
          return Promise.resolve(item);
        }),
      },
      openQuestion: {
        create: vi.fn().mockResolvedValue({ id: "q-1" }),
      },
      documentReference: {
        create: vi.fn().mockResolvedValue({ id: "doc-1" }),
      },
      proposal: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `prop-${proposalsStore.length + 1}`, ...data };
          proposalsStore.push(item);
          return Promise.resolve(item);
        }),
      },
      usageEvent: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `use-${usageEventsStore.length + 1}`, ...data };
          usageEventsStore.push(item);
          return Promise.resolve(item);
        }),
      },
    };

    // S3 Mock
    mockS3 = {
      send: vi.fn().mockImplementation(async (command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === "GetObjectCommand") {
          // Return an async iterable stream for audio
          return {
            Body: (async function* () {
              yield Buffer.from("RIFFmockwaveaudioheaderdata");
            })(),
          };
        }
        if (cmdName === "DeleteObjectCommand") {
          return {};
        }
        return {};
      }),
    };

    pipelineDeps = {
      prisma: mockDb as any,
      s3Client: mockS3,
      asrClient: new FakeSpeechToText(),
      llmClient: new FakeLlmClient(),
      pricingConfig: mockPricing,
      asrProviderName: "fake",
      llmProviderName: "fake",
    };
  });

  it("executes the full pipeline in demo mode end-to-end", async () => {
    const result = await processMeetingAudio(pipelineDeps, {
      meetingId,
      userId,
      s3Bucket,
      s3Key,
    });

    expect(result.meetingId).toBe(meetingId);
    expect(result.audioDurationSeconds).toBeGreaterThan(0);
    expect(result.segmentsCount).toBeGreaterThan(0);
    expect(result.decisionsCount).toBeGreaterThan(0);
    expect(result.tasksCount).toBeGreaterThan(0);
    expect(result.audioDeleted).toBe(true);

    // Verify S3 audio was downloaded
    expect(mockS3.send).toHaveBeenCalled();
  });

  it("Hard Invariant 4: Consent Gate blocks processing if consent is missing", async () => {
    // Override: no consent found
    mockDb.recordingConsent.findFirst.mockResolvedValue(null);

    await expect(
      processMeetingAudio(pipelineDeps, {
        meetingId,
        userId,
        s3Bucket,
        s3Key,
      }),
    ).rejects.toThrow("Invariant 4");

    // Verify meeting marked FAILED
    expect(mockDb.meeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: meetingId },
        data: expect.objectContaining({
          status: MeetingStatus.FAILED,
          failureReason: expect.stringContaining("Consent gate"),
        }),
      }),
    );
  });

  it("Hard Invariant 2: every decision and task cites source transcript segments", async () => {
    await processMeetingAudio(pipelineDeps, {
      meetingId,
      userId,
      s3Bucket,
      s3Key,
    });

    // Check decisions
    expect(mockDb.decision.create).toHaveBeenCalled();
    const decisionCalls = mockDb.decision.create.mock.calls;
    for (const [call] of decisionCalls) {
      expect(call.data.sourceSegmentIds).toBeDefined();
      expect(Array.isArray(call.data.sourceSegmentIds)).toBe(true);
      expect(call.data.sourceSegmentIds.length).toBeGreaterThan(0);
    }

    // Check tasks
    expect(mockDb.task.create).toHaveBeenCalled();
    const taskCalls = mockDb.task.create.mock.calls;
    for (const [call] of taskCalls) {
      expect(call.data.sourceSegmentIds).toBeDefined();
      expect(Array.isArray(call.data.sourceSegmentIds)).toBe(true);
      expect(call.data.sourceSegmentIds.length).toBeGreaterThan(0);
    }
  });

  it("Hard Invariant 3: unassigned tasks (missing owner or date) have needsReview: true", async () => {
    await processMeetingAudio(pipelineDeps, {
      meetingId,
      userId,
      s3Bucket,
      s3Key,
    });

    const taskCalls = mockDb.task.create.mock.calls;
    const unassignedCalls = taskCalls.filter(
      ([call]: any) => !call.data.ownerName || !call.data.dueDate,
    );

    expect(unassignedCalls.length).toBeGreaterThan(0);
    for (const [call] of unassignedCalls) {
      expect(call.data.needsReview).toBe(true);
    }
  });

  it("Hard Invariant 1: next meeting is created as a Proposal with PENDING_APPROVAL", async () => {
    await processMeetingAudio(pipelineDeps, {
      meetingId,
      userId,
      s3Bucket,
      s3Key,
    });

    expect(mockDb.proposal.create).toHaveBeenCalledTimes(1);
    const proposalCall = mockDb.proposal.create.mock.calls[0]?.[0];
    expect(proposalCall.data.actionType).toBe(ProposalActionType.SCHEDULE_MEETING);
    expect(proposalCall.data.status).toBe(ProposalStatus.PENDING_APPROVAL);
    expect(proposalCall.data.payload).toBeDefined();
  });

  it("Hard Invariant 5: raw audio is deleted from S3 according to retention policy", async () => {
    await processMeetingAudio(pipelineDeps, {
      meetingId,
      userId,
      s3Bucket,
      s3Key,
    });

    // S3 DeleteObjectCommand must have been sent
    const deleteCalls = mockS3.send.mock.calls.filter(
      ([cmd]: any) => cmd.constructor.name === "DeleteObjectCommand",
    );
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0][0].input).toEqual({
      Bucket: s3Bucket,
      Key: s3Key,
    });

    // DB audioDeletedAt must be updated
    expect(mockDb.meeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: meetingId },
        data: expect.objectContaining({
          audioDeletedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("Hard Invariant 7: usage events are logged for both ASR and LLM with real USD micros", async () => {
    await processMeetingAudio(pipelineDeps, {
      meetingId,
      userId,
      s3Bucket,
      s3Key,
    });

    const usageCalls = mockDb.usageEvent.create.mock.calls;
    expect(usageCalls.length).toBe(2);

    const asrEvent = usageCalls.find(
      ([c]: any) => c.data.operationType === "AUDIO_TRANSCRIPTION",
    )?.[0];
    const llmEvent = usageCalls.find(
      ([c]: any) => c.data.operationType === "LLM_ANALYSIS",
    )?.[0];

    expect(asrEvent).toBeDefined();
    expect(asrEvent.data.unit).toBe("minutes");
    expect(asrEvent.data.costMicros).toBeDefined();

    expect(llmEvent).toBeDefined();
    expect(llmEvent.data.unit).toBe("tokens");
    expect(llmEvent.data.costMicros).toBeDefined();
  });
});
