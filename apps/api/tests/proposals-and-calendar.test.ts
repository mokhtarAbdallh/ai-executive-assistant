import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { LocalAuthProvider } from "../src/auth/local.provider.js";
import { Role, ProposalActionType, ProposalStatus } from "@dawwen/db";
import type { Proposal, PrismaClient, CalendarConnection } from "@dawwen/db";
import { FakeCalendarProvider } from "../src/services/calendar.js";
import { ProposalExecutor, ProposalNotApprovedError } from "../src/services/proposal-executor.js";
import { ProposalRepository, CalendarConnectionRepository } from "@dawwen/db";
import { HkdfKeyProvider, TokenEncryptor } from "@dawwen/shared";

describe("Hard Invariant 1: Human-in-the-Loop & Calendar Proposals", () => {
  let app: FastifyInstance;
  let aliceToken: string;
  let bobToken: string;
  let fakeCalendar: FakeCalendarProvider;

  const aliceId = "usr-alice-prop";
  const bobId = "usr-bob-prop";
  const secret = "test-jwt-secret-at-least-32-chars-long!";

  const proposalsStore = new Map<string, Proposal>();
  const connectionsStore = new Map<string, CalendarConnection>();

  const mockPrisma = {
    user: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === aliceId) {
          return Promise.resolve({ id: aliceId, email: "alice@dawwen.ai", name: "Alice", role: Role.OWNER });
        }
        if (where.id === bobId) {
          return Promise.resolve({ id: bobId, email: "bob@dawwen.ai", name: "Bob", role: Role.OWNER });
        }
        return Promise.resolve(null);
      }),
    },
    proposal: {
      create: vi.fn().mockImplementation(({ data }: { data: any }) => {
        const id = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const record: Proposal = {
          id,
          userId: data.userId,
          meetingId: data.meetingId ?? null,
          actionType: data.actionType,
          payload: data.payload,
          status: data.status,
          reason: data.reason ?? null,
          executedAt: null,
          error: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        proposalsStore.set(id, record);
        return Promise.resolve(record);
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve(proposalsStore.get(where.id) || null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string; status?: ProposalStatus } }) => {
        const results = Array.from(proposalsStore.values()).filter((p) => {
          if (p.userId !== where.userId) return false;
          if (where.status && p.status !== where.status) return false;
          return true;
        });
        return Promise.resolve(results);
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) => {
        const record = proposalsStore.get(where.id);
        if (!record) throw new Error("Proposal not found");
        const updated: Proposal = {
          ...record,
          ...data,
          updatedAt: new Date(),
        };
        proposalsStore.set(where.id, updated);
        return Promise.resolve(updated);
      }),
    },
    calendarConnection: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { userId: string; provider: string } }) => {
        const found = Array.from(connectionsStore.values()).find(
          (c) => c.userId === where.userId && c.provider === where.provider,
        );
        return Promise.resolve(found || null);
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve(connectionsStore.get(where.id) || null);
      }),
      create: vi.fn().mockImplementation(({ data }: { data: any }) => {
        const id = `conn-${Date.now()}`;
        const record: CalendarConnection = {
          id,
          userId: data.userId,
          provider: data.provider,
          encryptedTokens: data.encryptedTokens,
          calendarId: data.calendarId,
          syncStatus: data.syncStatus,
          lastSyncedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        connectionsStore.set(id, record);
        return Promise.resolve(record);
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) => {
        const record = connectionsStore.get(where.id);
        if (!record) throw new Error("Connection not found");
        const updated = { ...record, ...data, updatedAt: new Date() };
        connectionsStore.set(where.id, updated);
        return Promise.resolve(updated);
      }),
      deleteMany: vi.fn().mockImplementation(({ where }: { where: { userId: string; provider: string } }) => {
        for (const [id, conn] of connectionsStore.entries()) {
          if (conn.userId === where.userId && conn.provider === where.provider) {
            connectionsStore.delete(id);
          }
        }
        return Promise.resolve({ count: 1 });
      }),
    },
    meeting: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  beforeAll(async () => {
    fakeCalendar = new FakeCalendarProvider();

    const localAuth = new LocalAuthProvider(mockPrisma as unknown as PrismaClient, secret);

    const aliceTokens = await localAuth.issueTokens({
      id: aliceId,
      email: "alice@dawwen.ai",
      name: "Alice",
      role: Role.OWNER,
    });
    aliceToken = aliceTokens.accessToken;

    const bobTokens = await localAuth.issueTokens({
      id: bobId,
      email: "bob@dawwen.ai",
      name: "Bob",
      role: Role.OWNER,
    });
    bobToken = bobTokens.accessToken;

    app = await buildApp({
      corsOrigins: ["http://localhost:5173"],
      appSecret: secret,
      localAuthProvider: localAuth,
      authProvider: localAuth,
      prisma: mockPrisma as unknown as PrismaClient,
      calendarProvider: fakeCalendar,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("AI code cannot book a calendar event directly — must stage as PENDING_APPROVAL proposal", async () => {
    const proposalId = "prop-ai-1";
    proposalsStore.set(proposalId, {
      id: proposalId,
      userId: aliceId,
      meetingId: null,
      actionType: ProposalActionType.SCHEDULE_MEETING,
      payload: {
        title: "Sprint Review Follow-up",
        proposedDatetime: new Date(Date.now() + 86400000).toISOString(),
        place: "Google Meet",
        participants: ["sarah@dawwen.ai"],
      },
      status: ProposalStatus.PENDING_APPROVAL,
      reason: "Follow-up proposed by AI analysis",
      executedAt: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Verify it is staged as PENDING_APPROVAL and NOT executed
    const stored = proposalsStore.get(proposalId);
    expect(stored?.status).toBe(ProposalStatus.PENDING_APPROVAL);
    expect(stored?.executedAt).toBeNull();
  });

  it("Direct execution attempt without authenticated user approval is blocked by ProposalExecutor", async () => {
    const keyProvider = new HkdfKeyProvider(secret);
    const encryptor = new TokenEncryptor(keyProvider);
    const propRepo = new ProposalRepository(mockPrisma as unknown as PrismaClient);
    const connRepo = new CalendarConnectionRepository(mockPrisma as unknown as PrismaClient);

    const executor = new ProposalExecutor(propRepo, connRepo, fakeCalendar, encryptor);

    // Staged rejected proposal
    const rejectedId = "prop-rejected-1";
    proposalsStore.set(rejectedId, {
      id: rejectedId,
      userId: aliceId,
      meetingId: null,
      actionType: ProposalActionType.SCHEDULE_MEETING,
      payload: { title: "Cancelled Event" },
      status: ProposalStatus.REJECTED,
      reason: "Rejected by user",
      executedAt: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Attempting to execute an already rejected proposal must throw ProposalNotApprovedError
    await expect(
      executor.approveAndExecute({ userId: aliceId }, rejectedId),
    ).rejects.toThrow(ProposalNotApprovedError);
  });

  it("Unauthenticated request to approve proposal is rejected with 401 Unauthorized", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/proposals/prop-ai-1/approve",
    });

    expect(res.statusCode).toBe(401);
  });

  it("Authenticated user approving proposal successfully executes booking on calendar and transitions to EXECUTED", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/proposals/prop-ai-1/approve?execute=true",
      headers: {
        authorization: `Bearer ${aliceToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe(ProposalStatus.EXECUTED);
    expect(body.proposalId).toBe("prop-ai-1");
    expect(body.details.title).toBe("Sprint Review Follow-up");
    expect(body.details.htmlLink).toContain("https://calendar.google.com");

    // DB state is updated
    const updated = proposalsStore.get("prop-ai-1");
    expect(updated?.status).toBe(ProposalStatus.EXECUTED);
    expect(updated?.executedAt).not.toBeNull();
  });

  it("Attempting to re-execute an already EXECUTED proposal fails (at-most-once execution)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/proposals/prop-ai-1/approve?execute=true",
      headers: {
        authorization: `Bearer ${aliceToken}`,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("must be approved by authenticated user first");
  });

  it("Rejecting a proposal transitions status to REJECTED with reason and cannot be booked", async () => {
    const propToReject = "prop-to-reject";
    proposalsStore.set(propToReject, {
      id: propToReject,
      userId: aliceId,
      meetingId: null,
      actionType: ProposalActionType.SCHEDULE_MEETING,
      payload: { title: "Unwanted follow-up" },
      status: ProposalStatus.PENDING_APPROVAL,
      reason: null,
      executedAt: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${propToReject}/reject`,
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { reason: "الوقت غير مناسب للعميل" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe(ProposalStatus.REJECTED);
    expect(body.reason).toBe("الوقت غير مناسب للعميل");
  });

  it("Cross-tenant isolation: Bob cannot approve or view Alice's proposal", async () => {
    // Bob attempts to approve Alice's proposal
    const approveRes = await app.inject({
      method: "POST",
      url: "/api/proposals/prop-ai-1/approve",
      headers: { authorization: `Bearer ${bobToken}` },
    });
    expect(approveRes.statusCode).toBe(400);

    // Bob attempts to fetch Alice's proposal
    const getRes = await app.inject({
      method: "GET",
      url: "/api/proposals/prop-ai-1",
      headers: { authorization: `Bearer ${bobToken}` },
    });
    expect(getRes.statusCode).toBe(403);
  });

  it("Calendar API: returns auth URL and allows connecting Google Calendar", async () => {
    const authUrlRes = await app.inject({
      method: "GET",
      url: "/api/calendar/auth-url",
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(authUrlRes.statusCode).toBe(200);
    expect(authUrlRes.json().authUrl).toContain("/api/calendar/callback");

    // Connect via callback
    const callbackRes = await app.inject({
      method: "POST",
      url: "/api/calendar/callback",
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { code: "demo_google_code" },
    });

    expect(callbackRes.statusCode).toBe(200);
    expect(callbackRes.json().connected).toBe(true);

    // Status shows connected
    const statusRes = await app.inject({
      method: "GET",
      url: "/api/calendar/status",
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().connected).toBe(true);
  });

  it("Calendar API: lists unified events for the calendar view", async () => {
    const eventsRes = await app.inject({
      method: "GET",
      url: "/api/calendar/events",
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(eventsRes.statusCode).toBe(200);
    const events = eventsRes.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty("title");
    expect(events[0]).toHaveProperty("start");
    expect(events[0]).toHaveProperty("end");
  });
});
