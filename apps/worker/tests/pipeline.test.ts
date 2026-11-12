import { describe, it, expect, vi, beforeEach } from "vitest";
import { processMeetingAudio, type PipelineDependencies } from "../src/pipeline.js";
import { FakeSpeechToText } from "@dawwen/asr";
import { FakeLlmClient, LlmAnalysisFailedError } from "@dawwen/llm";
import {
  InsufficientBalanceError,
  MeetingStatus,
  ProposalActionType,
  ProposalStatus,
} from "@dawwen/db";
import {
  createMemoryPrisma,
  seedQueuedMeeting,
  type MemoryPrisma,
} from "./helpers/memory-prisma.js";

describe("Worker Pipeline (@dawwen/worker)", () => {
  const userId = "user-pipeline-test";
  const meetingId = "meet-pipeline-test";
  const s3Bucket = "test-audio-bucket";
  const s3Key = `uploads/${userId}/${meetingId}/sample-audio.mp3`;
  const params = { meetingId, userId, s3Bucket, s3Key };

  const mockPricing = {
    customerPricePerAudioMinuteMicros: 20000,
    providerCosts: {
      asrPerAudioMinuteMicros: { fake: 0, elevenlabs: 5000 },
      llmPerMillionInputTokensMicros: { fake: 1_000_000, bedrock: 3000000 },
      llmPerMillionOutputTokensMicros: { fake: 1_000_000, bedrock: 15000000 },
      embeddingsPerMillionTokensMicros: { fake: 0, bedrock: 100000 },
    },
    lowBalanceThresholdMicros: 1000000,
  };

  let db: MemoryPrisma;
  let mockS3: { send: ReturnType<typeof vi.fn> };
  let pipelineDeps: PipelineDependencies;

  const meeting = () => db.tables.meeting![0]!;
  const usage = (type: string) => db.tables.usageEvent!.filter((e) => e.operationType === type);

  beforeEach(() => {
    db = createMemoryPrisma();
    seedQueuedMeeting(db, { meetingId, userId, s3Key });

    mockS3 = {
      send: vi.fn().mockImplementation(async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === "GetObjectCommand") {
          return {
            Body: (async function* () {
              yield Buffer.from("RIFFmockwaveaudioheaderdata");
            })(),
          };
        }
        return {};
      }),
    };

    pipelineDeps = {
      prisma: db as never,
      s3Client: mockS3 as never,
      asrClient: new FakeSpeechToText(),
      llmClient: new FakeLlmClient(),
      pricingConfig: mockPricing,
      asrProviderName: "fake",
      llmProviderName: "fake",
    };
  });

  it("executes the full pipeline end-to-end and ends in REVIEW_PENDING", async () => {
    const result = await processMeetingAudio(pipelineDeps, params);

    expect(result.skipped).toBe(false);
    expect(result.audioDurationSeconds).toBeGreaterThan(0);
    expect(result.segmentsCount).toBeGreaterThan(0);
    expect(result.decisionsCount).toBeGreaterThan(0);
    expect(result.tasksCount).toBeGreaterThan(0);
    expect(result.audioDeleted).toBe(true);
    expect(meeting().status).toBe(MeetingStatus.REVIEW_PENDING);
  });

  it("skips a duplicate delivery: only a QUEUED meeting can be claimed", async () => {
    await processMeetingAudio(pipelineDeps, params);
    const segmentsAfterFirstRun = db.tables.transcriptSegment!.length;

    const second = await processMeetingAudio(pipelineDeps, params);

    expect(second.skipped).toBe(true);
    expect(db.tables.transcriptSegment!.length).toBe(segmentsAfterFirstRun);
    expect(usage("AUDIO_TRANSCRIPTION")).toHaveLength(1);
  });

  it("a retry starts from a clean slate (no duplicated results)", async () => {
    // Leftovers of an earlier failed attempt.
    db.tables.transcriptSegment!.push({ id: "old-seg", meetingId, text: "stale" });
    db.tables.decision!.push({ id: "old-dec", meetingId, text: "stale" });
    db.tables.proposal!.push({
      id: "old-prop",
      meetingId,
      status: ProposalStatus.PENDING_APPROVAL,
    });

    await processMeetingAudio(pipelineDeps, params);

    const ids = (t: string) => db.tables[t]!.map((r) => r.id);
    expect(ids("transcriptSegment")).not.toContain("old-seg");
    expect(ids("decision")).not.toContain("old-dec");
    expect(ids("proposal")).not.toContain("old-prop");
    expect(db.tables.proposal!).toHaveLength(1);
  });

  it("Hard Invariant 4: Consent Gate fails the meeting if consent is missing", async () => {
    db.tables.recordingConsent!.length = 0;

    await expect(processMeetingAudio(pipelineDeps, params)).rejects.toThrow("Invariant 4");

    expect(meeting().status).toBe(MeetingStatus.FAILED);
    expect(meeting().failureReason).toContain("Consent gate");
    expect(mockS3.send).not.toHaveBeenCalled();
  });

  it("any failure marks the meeting FAILED with a reason and keeps the audio for a retry", async () => {
    pipelineDeps.asrClient = {
      providerName: "fake",
      transcribe: vi.fn().mockRejectedValue(new Error("ASR service unavailable")),
    } as never;

    await expect(processMeetingAudio(pipelineDeps, params)).rejects.toThrow();

    expect(meeting().status).toBe(MeetingStatus.FAILED);
    expect(meeting().failureReason).toContain("ASR service unavailable");
    expect(meeting().audioDeletedAt).toBeNull();
  });

  describe("credit hold (ADR-023)", () => {
    let credits: {
      reserveCredits: ReturnType<typeof vi.fn>;
      settleCredits: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      credits = {
        reserveCredits: vi.fn().mockResolvedValue({}),
        settleCredits: vi.fn().mockResolvedValue({ shortfallMicros: 0n }),
      };
      pipelineDeps.credits = credits as never;
    });

    it("holds credit before transcription and settles hold vs. real cost after", async () => {
      await processMeetingAudio(pipelineDeps, params);

      expect(credits.reserveCredits).toHaveBeenCalled();
      const held = credits.reserveCredits.mock.calls.reduce(
        (sum, call) => sum + (call[1] as bigint),
        0n,
      );
      const [, holdArg, actualArg] = credits.settleCredits.mock.calls[0]!;
      expect(holdArg).toBe(held);
      expect(actualArg as bigint).toBeGreaterThan(0n);
      expect(meeting().creditHoldMicros).toBe(0n);
    });

    it("insufficient balance fails the meeting before paying for ASR", async () => {
      credits.reserveCredits.mockRejectedValue(new InsufficientBalanceError(0n, 20000n));
      const asr = new FakeSpeechToText();
      const transcribe = vi.spyOn(asr, "transcribe");
      pipelineDeps.asrClient = asr;

      await expect(processMeetingAudio(pipelineDeps, params)).rejects.toThrow("Balance gate");

      expect(transcribe).not.toHaveBeenCalled();
      expect(meeting().status).toBe(MeetingStatus.FAILED);
      expect(meeting().failureReason).toContain("Balance gate");
    });

    it("a failed run releases the hold without charging", async () => {
      pipelineDeps.llmClient = {
        providerName: "fake",
        analyzeMeeting: vi.fn().mockRejectedValue(new Error("boom")),
      };

      await expect(processMeetingAudio(pipelineDeps, params)).rejects.toThrow();

      expect(credits.settleCredits).toHaveBeenCalledTimes(1);
      const [, holdArg, actualArg] = credits.settleCredits.mock.calls[0]!;
      expect(holdArg as bigint).toBeGreaterThan(0n);
      expect(actualArg).toBe(0n);
      expect(meeting().creditHoldMicros).toBe(0n);
    });
  });

  it("Invariant 7: tokens burnt by a failed LLM analysis are still metered", async () => {
    pipelineDeps.llmClient = {
      providerName: "fake",
      analyzeMeeting: vi
        .fn()
        .mockRejectedValue(new LlmAnalysisFailedError("invalid JSON x3", 3000, 600, "fake-model")),
    };

    await expect(processMeetingAudio(pipelineDeps, params)).rejects.toThrow("Analysis failed");

    const [event] = usage("LLM_ANALYSIS");
    expect(event).toBeDefined();
    expect(event!.quantity).toBe(3600);
    expect(event!.costMicros as bigint).toBeGreaterThan(0n);
    expect(event!.metadata).toMatchObject({ failed: true });
    expect(meeting().status).toBe(MeetingStatus.FAILED);
  });

  it("Hard Invariant 2: every decision and task cites source transcript segments", async () => {
    await processMeetingAudio(pipelineDeps, params);

    for (const table of ["decision", "task"]) {
      expect(db.tables[table]!.length).toBeGreaterThan(0);
      for (const row of db.tables[table]!) {
        expect((row.sourceSegmentIds as string[]).length).toBeGreaterThan(0);
      }
    }
  });

  it("Hard Invariant 3: unassigned tasks (missing owner or date) have needsReview: true", async () => {
    await processMeetingAudio(pipelineDeps, params);

    const unassigned = db.tables.task!.filter((t) => !t.ownerName || !t.dueDate);
    expect(unassigned.length).toBeGreaterThan(0);
    for (const t of unassigned) expect(t.needsReview).toBe(true);
  });

  it("Hard Invariant 1: next meeting is created as a Proposal with PENDING_APPROVAL", async () => {
    await processMeetingAudio(pipelineDeps, params);

    expect(db.tables.proposal!).toHaveLength(1);
    const proposal = db.tables.proposal![0]!;
    expect(proposal.actionType).toBe(ProposalActionType.SCHEDULE_MEETING);
    expect(proposal.status).toBe(ProposalStatus.PENDING_APPROVAL);
    expect(proposal.payload).toBeDefined();
  });

  it("Hard Invariant 5: raw audio is deleted from S3 by default", async () => {
    await processMeetingAudio(pipelineDeps, params);

    const deleteCalls = mockS3.send.mock.calls.filter(
      ([cmd]) =>
        (cmd as { constructor: { name: string } }).constructor.name === "DeleteObjectCommand",
    );
    expect(deleteCalls).toHaveLength(1);
    expect((deleteCalls[0]![0] as { input: unknown }).input).toEqual({
      Bucket: s3Bucket,
      Key: s3Key,
    });
    expect(meeting().audioDeletedAt).toBeInstanceOf(Date);
  });

  it("keeps the audio when the user opted into retention", async () => {
    db.tables.userSettings![0]!.audioRetentionDays = 7;

    const result = await processMeetingAudio(pipelineDeps, params);

    expect(result.audioDeleted).toBe(false);
    expect(meeting().audioDeletedAt).toBeNull();
  });

  it("Hard Invariant 7: usage events are logged for both ASR and LLM", async () => {
    await processMeetingAudio(pipelineDeps, params);

    expect(db.tables.usageEvent!).toHaveLength(2);
    expect(usage("AUDIO_TRANSCRIPTION")[0]!.unit).toBe("minutes");
    expect(usage("LLM_ANALYSIS")[0]!.unit).toBe("tokens");
  });

  it("generates pgvector embeddings + EMBEDDING_GENERATION usage event (ADR-016)", async () => {
    const embeddingClient = {
      providerName: "fake-embeddings",
      embed: vi.fn().mockResolvedValue([
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
        [0.7, 0.8],
      ]),
    };

    await processMeetingAudio(
      {
        ...pipelineDeps,
        embeddingClient,
        pricingConfig: {
          ...mockPricing,
          providerCosts: {
            ...mockPricing.providerCosts,
            embeddingsPerMillionTokensMicros: { "fake-embeddings": 20000 },
          },
        },
      },
      params,
    );

    expect(db.$executeRaw.mock.calls.length).toBeGreaterThan(0);
    const [event] = usage("EMBEDDING_GENERATION");
    expect(event!.unit).toBe("tokens");
    expect(event!.quantity as number).toBeGreaterThan(0);
    expect(Number(event!.costMicros)).toBeGreaterThan(0);
  });

  it("embedding failures are non-fatal: pipeline still completes (keyword search fallback)", async () => {
    db.$executeRaw.mockRejectedValue(new Error("pgvector down"));
    const embeddingClient = {
      providerName: "fake-embeddings",
      embed: vi.fn().mockResolvedValue([[0.1, 0.2]]),
    };

    const result = await processMeetingAudio({ ...pipelineDeps, embeddingClient }, params);

    expect(result.decisionsCount).toBeGreaterThan(0);
    expect(meeting().status).toBe(MeetingStatus.REVIEW_PENDING);
  });
});
