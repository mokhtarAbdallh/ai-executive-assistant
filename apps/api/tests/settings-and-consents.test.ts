import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { LocalAuthProvider } from "../src/auth/local.provider.js";
import { Role } from "@dawwen/db";

import type { PrismaClient, RecordingConsent } from "@dawwen/db";

describe("Settings & Consents API", () => {
  let app: FastifyInstance;
  let userToken: string;
  const testUserId = "user-settings-tester-1";

  const mockSettings = {
    userId: testUserId,
    language: "ar",
    timezone: "Africa/Cairo",
    audioRetentionDays: 7,
  };

  const mockConsents: RecordingConsent[] = [];

  const mockPrisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: testUserId,
        email: "tester@dawwen.ai",
        name: "Tester",
        role: Role.OWNER,
      }),
    },
    userSettings: {
      upsert: vi.fn().mockImplementation(({ create, update }: { create?: typeof mockSettings; update?: Partial<typeof mockSettings> }) => {
        Object.assign(mockSettings, update || create);
        return Promise.resolve({ ...mockSettings });
      }),
    },
    recordingConsent: {
      create: vi.fn().mockImplementation(({ data }: { data: Omit<RecordingConsent, "id" | "consentedAt"> }) => {
        const consent: RecordingConsent = {
          id: `consent-${Date.now()}`,
          ...data,
          meetingId: data.meetingId ?? null,
          participantEmail: data.participantEmail ?? null,
          ipAddress: data.ipAddress ?? null,
          userAgent: data.userAgent ?? null,
          consentedAt: new Date(),
        };
        mockConsents.push(consent);
        return Promise.resolve(consent);
      }),
      findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        return Promise.resolve(
          mockConsents.filter((c) => c.userId === where.userId),
        );
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

    const tokens = await localAuthProvider.issueTokens({
      id: testUserId,
      email: "tester@dawwen.ai",
      name: "Tester",
      role: Role.OWNER,
    });
    userToken = tokens.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/settings returns user's default settings", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settings.language).toBe("ar");
    expect(body.settings.timezone).toBe("Africa/Cairo");
    expect(body.settings.audioRetentionDays).toBe(7);
  });

  it("PUT /api/settings updates language and audioRetentionDays", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        language: "en",
        audioRetentionDays: 14,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settings.language).toBe("en");
    expect(body.settings.audioRetentionDays).toBe(14);
  });

  it("POST /api/consents records consent and GET /api/consents lists it", async () => {
    const postRes = await app.inject({
      method: "POST",
      url: "/api/consents",
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        participantName: "سارة محمد",
        participantEmail: "sara@example.com",
        consentMethod: "ui_checkbox",
      },
    });

    expect(postRes.statusCode).toBe(201);
    expect(postRes.json().consent.participantName).toBe("سارة محمد");

    const getRes = await app.inject({
      method: "GET",
      url: "/api/consents",
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().consents.length).toBeGreaterThan(0);
    expect(getRes.json().consents[0].participantName).toBe("سارة محمد");
  });
});
