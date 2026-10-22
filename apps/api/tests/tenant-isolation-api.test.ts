import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { LocalAuthProvider } from "../src/auth/local.provider.js";
import { Role, ProposalActionType, ProposalStatus } from "@dawwen/db";

import type { Proposal, PrismaClient } from "@dawwen/db";

describe("API Tenant Isolation: A user can never read or modify another user's data", () => {
  let app: FastifyInstance;
  let aliceToken: string;
  let bobToken: string;

  const aliceId = "user-alice-isolated";
  const bobId = "user-bob-isolated";

  const proposalsStore = new Map<string, Proposal>([
    [
      "prop-alice-1",
      {
        id: "prop-alice-1",
        userId: aliceId,
        meetingId: null,
        actionType: ProposalActionType.SCHEDULE_MEETING,
        payload: { title: "Alice Confidential Strategy" },
        status: ProposalStatus.PENDING_APPROVAL,
        reason: null,
        executedAt: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      "prop-bob-1",
      {
        id: "prop-bob-1",
        userId: bobId,
        meetingId: null,
        actionType: ProposalActionType.DRAFT_EMAIL,
        payload: { subject: "Bob's Invoice" },
        status: ProposalStatus.PENDING_APPROVAL,
        reason: null,
        executedAt: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  ]);

  const mockPrisma = {
    user: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === aliceId) {
          return Promise.resolve({ id: aliceId, email: "alice@example.com", name: "Alice", role: Role.OWNER });
        }
        if (where.id === bobId) {
          return Promise.resolve({ id: bobId, email: "bob@example.com", name: "Bob", role: Role.OWNER });
        }
        return Promise.resolve(null);
      }),
    },
    proposal: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve(proposalsStore.get(where.id) || null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        return Promise.resolve(
          Array.from(proposalsStore.values()).filter((p) => p.userId === where.userId),
        );
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Partial<Proposal> }) => {
        const existing = proposalsStore.get(where.id);
        if (existing) {
          Object.assign(existing, data);
          return Promise.resolve(existing);
        }
        return Promise.resolve(null);
      }),
    },
    userSettings: {
      upsert: vi.fn().mockImplementation(({ where, create, update }: { where: { userId: string }; create?: { language?: string; timezone?: string; audioRetentionDays?: number }; update?: { language?: string; timezone?: string; audioRetentionDays?: number } }) => {
        return Promise.resolve({
          userId: where.userId,
          language: update?.language || create?.language || "ar",
          timezone: update?.timezone || create?.timezone || "Africa/Cairo",
          audioRetentionDays: update?.audioRetentionDays || create?.audioRetentionDays || 7,
        });
      }),
    },
    recordingConsent: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        return Promise.resolve(where.userId === aliceId ? [{ id: "c-alice", userId: aliceId, participantName: "Alice Guest" }] : []);
      }),
    },
  } as unknown as PrismaClient;

  const testSecret = "test-secret-key-that-is-at-least-32-chars-long";
  const localAuthProvider = new LocalAuthProvider(mockPrisma, testSecret);

  beforeAll(async () => {
    app = await buildApp({
      corsOrigins: ["http://localhost:5173"],
      logLevel: "silent",
      appSecret: testSecret,
      prisma: mockPrisma,
      localAuthProvider,
      authProvider: localAuthProvider,
    });

    const aliceTokens = await localAuthProvider.issueTokens({
      id: aliceId,
      email: "alice@example.com",
      name: "Alice",
      role: Role.OWNER,
    });
    aliceToken = aliceTokens.accessToken;

    const bobTokens = await localAuthProvider.issueTokens({
      id: bobId,
      email: "bob@example.com",
      name: "Bob",
      role: Role.OWNER,
    });
    bobToken = bobTokens.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("User B receives only their proposals from GET /api/proposals", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/proposals",
      headers: { authorization: `Bearer ${bobToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { proposals } = res.json();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].id).toBe("prop-bob-1");
    expect(proposals[0].userId).toBe(bobId);
  });

  it("User B is blocked from approving User A's proposal (400 Cross-tenant violation)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/proposals/prop-alice-1/approve",
      headers: { authorization: `Bearer ${bobToken}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("Cross-tenant access violation");

    // Alice's proposal remains PENDING_APPROVAL
    expect(proposalsStore.get("prop-alice-1")!.status).toBe(ProposalStatus.PENDING_APPROVAL);
  });

  it("User A can successfully approve their own proposal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/proposals/prop-alice-1/approve",
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().proposal.status).toBe(ProposalStatus.APPROVED);
    expect(proposalsStore.get("prop-alice-1")!.status).toBe(ProposalStatus.APPROVED);
  });

  it("User B cannot see User A's consents", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/consents",
      headers: { authorization: `Bearer ${bobToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().consents).toHaveLength(0);
  });
});
