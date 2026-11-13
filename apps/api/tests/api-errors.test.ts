import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { LocalAuthProvider } from "../src/auth/local.provider.js";
import { Role, type PrismaClient } from "@dawwen/db";

/** ADR-024: one error handler, Zod on query strings, keyset pagination for meetings. */
describe("API error handling and meetings pagination", () => {
  const ownerId = "user-owner";
  const otherId = "user-other";
  let app: FastifyInstance;
  let ownerToken: string;
  let otherToken: string;

  // 5 meetings of the owner, newest first by createdAt.
  const meetings = Array.from({ length: 5 }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    userId: ownerId,
    title: `Meeting ${i}`,
    createdAt: new Date(Date.UTC(2026, 10, 1 + i)),
    _count: { tasks: 0, decisions: 0, transcriptSegments: 0 },
  }));

  type Where = {
    userId: string;
    OR?: Array<{ createdAt: Date | { lt: Date }; id?: { lt: string } }>;
  };
  const findMany = vi.fn(async ({ where, take }: { where: Where; take: number }) => {
    let rows = meetings
      .filter((m) => m.userId === where.userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
    if (where.OR) {
      const before = (where.OR[0]!.createdAt as { lt: Date }).lt;
      const tieId = where.OR[1]!.id!.lt;
      rows = rows.filter(
        (m) => m.createdAt < before || (m.createdAt.getTime() === before.getTime() && m.id < tieId),
      );
    }
    return rows.slice(0, take);
  });

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
      findMany,
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === "explodes") throw new Error("db password=hunter2 leaked in message");
        return meetings.find((m) => m.id === where.id) ?? null;
      }),
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
      audioQueue: { enqueue: vi.fn() },
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

  const get = (url: string, token = ownerToken) =>
    app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  it("pages through meetings with a cursor, newest first, without gaps or repeats", async () => {
    const first = await get("/api/meetings?limit=2");
    expect(first.statusCode).toBe(200);
    expect(first.json().map((m: { title: string }) => m.title)).toEqual(["Meeting 4", "Meeting 3"]);
    const cursor1 = first.headers["x-next-cursor"] as string;
    expect(cursor1).toBeTruthy();

    const second = await get(`/api/meetings?limit=2&cursor=${cursor1}`);
    expect(second.json().map((m: { title: string }) => m.title)).toEqual([
      "Meeting 2",
      "Meeting 1",
    ]);

    const third = await get(
      `/api/meetings?limit=2&cursor=${second.headers["x-next-cursor"] as string}`,
    );
    expect(third.json().map((m: { title: string }) => m.title)).toEqual(["Meeting 0"]);
    expect(third.headers["x-next-cursor"]).toBeUndefined();
  });

  it("rejects invalid query strings with 400 instead of guessing", async () => {
    expect((await get("/api/meetings?limit=0")).statusCode).toBe(400);
    expect((await get("/api/meetings?limit=1000")).statusCode).toBe(400);
    expect((await get("/api/meetings?status=NOPE")).statusCode).toBe(400);
    expect((await get("/api/meetings?cursor=garbage")).statusCode).toBe(400);
    expect((await get("/api/billing/transactions?limit=abc")).statusCode).toBe(400);
    expect((await get("/api/calendar/events?start=not-a-date")).statusCode).toBe(400);
    expect((await get("/api/search?q=x&meetingId=not-a-uuid")).statusCode).toBe(400);
  });

  it("returns 404 (not 500) for another user's meeting", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/meetings/${meetings[0]!.id}/tasks/t1`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { title: "hijack" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("returns 404 for a meeting that does not exist", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/meetings/missing/decisions/d1",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { text: "x" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("hides internal error messages behind a generic 500", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/meetings/explodes/tasks/t1",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: "x" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal_error" });
    expect(res.body).not.toContain("hunter2");
  });
});
