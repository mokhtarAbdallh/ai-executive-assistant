/**
 * Pipeline against real Postgres (ADR-023). Skipped unless TEST_DATABASE_URL is set:
 *
 *   TEST_DATABASE_URL=postgresql://dawwen:dawwen@localhost:55432/dawwen_test pnpm --filter @dawwen/worker test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CreditRepository, MeetingStatus, PrismaClient } from "@dawwen/db";
import { FakeSpeechToText } from "@dawwen/asr";
import { FakeLlmClient } from "@dawwen/llm";
import { processMeetingAudio, type PipelineDependencies } from "../src/pipeline.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("worker pipeline (real Postgres)", () => {
  let prisma: PrismaClient;
  const userId = `usr-pipe-${Date.now()}`;
  const s3Bucket = "bucket";

  const deps = (): PipelineDependencies => ({
    prisma: prisma as never,
    s3Client: {
      send: vi.fn(async (cmd: { constructor: { name: string } }) =>
        cmd.constructor.name === "GetObjectCommand"
          ? {
              Body: (async function* () {
                yield Buffer.from("audio");
              })(),
            }
          : {},
      ),
    } as never,
    asrClient: new FakeSpeechToText(),
    llmClient: new FakeLlmClient(),
    pricingConfig: {
      customerPricePerAudioMinuteMicros: 20_000,
      providerCosts: {
        asrPerAudioMinuteMicros: {},
        llmPerMillionInputTokensMicros: {},
        llmPerMillionOutputTokensMicros: {},
        embeddingsPerMillionTokensMicros: {},
      },
      lowBalanceThresholdMicros: 0,
    },
    asrProviderName: "fake",
    llmProviderName: "fake",
    credits: new CreditRepository(prisma as never),
  });

  async function queuedMeeting(): Promise<{ id: string; s3Key: string }> {
    const m = await prisma.meeting.create({
      data: { userId, title: "db pipeline", status: MeetingStatus.QUEUED },
    });
    await prisma.recordingConsent.create({
      data: { userId, meetingId: m.id, participantName: "Tester", consentMethod: "test" },
    });
    return { id: m.id, s3Key: `uploads/${userId}/${m.id}/a.mp3` };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@test.local`,
        name: "Pipeline Test",
        settings: { create: {} },
        creditLedger: { create: { balanceMicros: 10_000_000n, reservedMicros: 0n } },
      },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("processes a meeting exactly once under 5 concurrent deliveries and charges once", async () => {
    const m = await queuedMeeting();
    const before = await prisma.creditLedger.findUniqueOrThrow({ where: { userId } });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        processMeetingAudio(deps(), { meetingId: m.id, userId, s3Bucket, s3Key: m.s3Key }),
      ),
    );

    expect(results.filter((r) => !r.skipped)).toHaveLength(1);
    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } });
    expect(stored.status).toBe(MeetingStatus.REVIEW_PENDING);
    expect(stored.creditHoldMicros).toBe(0n);
    expect(await prisma.meetingAnalysis.count({ where: { meetingId: m.id } })).toBe(1);
    expect(
      await prisma.usageEvent.count({
        where: { meetingId: m.id, operationType: "AUDIO_TRANSCRIPTION" },
      }),
    ).toBe(1);

    const after = await prisma.creditLedger.findUniqueOrThrow({ where: { userId } });
    expect(after.reservedMicros).toBe(before.reservedMicros);
    expect(after.balanceMicros).toBeLessThan(before.balanceMicros);
    // Raw audio deleted by default (retention 0).
    expect(stored.audioDeletedAt).toBeInstanceOf(Date);
  });

  it("a failed run can be retried and yields a single clean set of results", async () => {
    const m = await queuedMeeting();
    const failing = deps();
    failing.llmClient = {
      providerName: "fake",
      analyzeMeeting: vi.fn().mockRejectedValue(new Error("model down")),
    };

    await expect(
      processMeetingAudio(failing, { meetingId: m.id, userId, s3Bucket, s3Key: m.s3Key }),
    ).rejects.toThrow();
    const failed = await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } });
    expect(failed.status).toBe(MeetingStatus.FAILED);
    expect(failed.creditHoldMicros).toBe(0n);
    const segmentsAfterFailure = await prisma.transcriptSegment.count({
      where: { meetingId: m.id },
    });
    expect(segmentsAfterFailure).toBeGreaterThan(0);

    // What POST /api/meetings/:id/retry does.
    await prisma.meeting.update({ where: { id: m.id }, data: { status: MeetingStatus.QUEUED } });
    await processMeetingAudio(deps(), { meetingId: m.id, userId, s3Bucket, s3Key: m.s3Key });

    const done = await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } });
    expect(done.status).toBe(MeetingStatus.REVIEW_PENDING);
    expect(await prisma.transcriptSegment.count({ where: { meetingId: m.id } })).toBe(
      segmentsAfterFailure,
    );
    const ledger = await prisma.creditLedger.findUniqueOrThrow({ where: { userId } });
    expect(ledger.reservedMicros).toBe(0n);
  });

  it("keeps usage events when the meeting is deleted (billing audit trail)", async () => {
    const m = await queuedMeeting();
    await processMeetingAudio(deps(), { meetingId: m.id, userId, s3Bucket, s3Key: m.s3Key });
    const eventIds = (await prisma.usageEvent.findMany({ where: { meetingId: m.id } })).map(
      (e) => e.id,
    );
    expect(eventIds.length).toBeGreaterThan(0);

    await prisma.meeting.delete({ where: { id: m.id } });

    const kept = await prisma.usageEvent.findMany({ where: { id: { in: eventIds } } });
    expect(kept).toHaveLength(eventIds.length);
    expect(kept.every((e) => e.meetingId === null)).toBe(true);
  });
});
