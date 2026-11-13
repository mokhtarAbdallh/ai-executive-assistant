import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { LocalAuthProvider } from "../src/auth/local.provider.js";
import { MeetingStatus, Role, type PrismaClient } from "@dawwen/db";
import type { AudioQueue } from "../src/services/audio-queue.js";

describe("POST /api/meetings/:id/retry (ADR-023)", () => {
  const ownerId = "user-retry-owner";
  const otherId = "user-retry-other";
  let app: FastifyInstance;
  let ownerToken: string;
  let otherToken: string;
  let meeting: Record<string, unknown>;
  const enqueue = vi.fn<AudioQueue["enqueue"]>();

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        email: `${where.id}@test.local`,
        name: "T",
        role: Role.OWNER,
      })),
    },
    meeting: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === meeting.id ? { ...meeting } : null,
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; status: string }; data: object }) => {
          if (where.id !== meeting.id || meeting.status !== where.status) return { count: 0 };
          Object.assign(meeting, data);
          return { count: 1 };
        },
      ),
    },
  } as unknown as PrismaClient;

  const secret = "test-secret-key-that-is-at-least-32-chars-long";
  const auth = new LocalAuthProvider(prisma, secret);

  beforeAll(async () => {
    app = await buildApp({
      corsOrigins: [],
      logLevel: "silent",
      appSecret: secret,
      prisma,
      localAuthProvider: auth,
      authProvider: auth,
      audioQueue: { enqueue },
    });
    const token = async (id: string) =>
      (await auth.issueAccessToken({ id, email: `${id}@test.local`, name: "T", role: Role.OWNER }))
        .accessToken;
    ownerToken = await token(ownerId);
    otherToken = await token(otherId);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    enqueue.mockReset().mockResolvedValue(undefined);
    meeting = {
      id: "m-failed",
      userId: ownerId,
      status: MeetingStatus.FAILED,
      failureReason: "Analysis failed: model down",
      audioS3Key: `uploads/${ownerId}/m-failed/a.mp3`,
      audioDeletedAt: null,
    };
  });

  const retry = (token: string, id = "m-failed") =>
    app.inject({
      method: "POST",
      url: `/api/meetings/${id}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

  it("re-queues a failed meeting and sends a job to the worker queue", async () => {
    const res = await retry(ownerToken);

    expect(res.statusCode).toBe(202);
    expect(meeting.status).toBe(MeetingStatus.QUEUED);
    expect(meeting.failureReason).toBeNull();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: "m-failed",
        userId: ownerId,
        s3Key: meeting.audioS3Key,
      }),
    );
  });

  it("refuses meetings that are not FAILED (no double processing)", async () => {
    meeting.status = MeetingStatus.TRANSCRIBING;
    const res = await retry(ownerToken);
    expect(res.statusCode).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("concurrent retries enqueue only one job", async () => {
    const results = await Promise.all([retry(ownerToken), retry(ownerToken), retry(ownerToken)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([202, 409, 409]);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("explains when the raw audio was already deleted", async () => {
    meeting.audioDeletedAt = new Date();
    const res = await retry(ownerToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("audio_unavailable");
  });

  it("returns 404 for another user's meeting", async () => {
    const res = await retry(otherToken);
    expect(res.statusCode).toBe(404);
    expect(meeting.status).toBe(MeetingStatus.FAILED);
  });

  it("rolls back to FAILED when the queue is unreachable", async () => {
    enqueue.mockRejectedValue(new Error("sqs down"));
    const res = await retry(ownerToken);
    expect(res.statusCode).toBe(503);
    expect(meeting.status).toBe(MeetingStatus.FAILED);
  });
});
