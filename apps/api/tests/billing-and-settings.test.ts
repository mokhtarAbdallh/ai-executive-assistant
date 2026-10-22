import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { LocalAuthProvider } from "../src/auth/local.provider.js";
import {
  Role,
  MeetingStatus,
  type PrismaClient,
  type Meeting,
  type CreditLedger,
  type CreditTransaction,
  type UsageEvent,
  CreditTransactionType,
} from "@dawwen/db";
import { DataManagementService } from "../src/services/data-management.js";
import { ManualPaymentAdapter } from "../src/services/payment.js";
import { CreditRepository, MeetingRepository } from "@dawwen/db";
import { processMeetingAudio } from "../../worker/src/pipeline.js";
import { FakeSpeechToText } from "@dawwen/asr";
import { FakeLlmClient } from "@dawwen/llm";

describe("Phase 6: Billing, Usage, Balance Gating, and Data Deletion / Export", () => {
  let app: FastifyInstance;
  let aliceToken: string;
  let bobToken: string;

  const aliceId = "usr-alice-phase6";
  const bobId = "usr-bob-phase6";
  const aliceMeetingId = "mtg-alice-phase6-001";
  const bobMeetingId = "mtg-bob-phase6-001";
  const secret = "test-jwt-secret-at-least-32-chars-long!";

  // In-memory test stores
  const meetingsStore = new Map<string, Meeting>();
  const ledgersStore = new Map<string, CreditLedger>();
  const transactionsStore: CreditTransaction[] = [];
  const usageEventsStore: UsageEvent[] = [];
  const embeddingsStore: { meetingId: string; text: string }[] = [];
  const s3DeletedKeys: string[] = [];

  const mockS3Client = {
    send: vi.fn().mockImplementation((command: any) => {
      if (command.constructor.name === "DeleteObjectCommand" || command.input?.Key) {
        s3DeletedKeys.push(command.input.Key);
      }
      return Promise.resolve({});
    }),
  } as any;

  beforeAll(async () => {
    // Setup initial test data
    const aliceMeeting: Meeting = {
      id: aliceMeetingId,
      userId: aliceId,
      title: "اجتماع تسعير المنتجات وتوزيع الحصص",
      scheduledStart: new Date("2026-10-25T10:00:00Z"),
      scheduledEnd: new Date("2026-10-25T11:00:00Z"),
      actualStart: new Date("2026-10-25T10:00:00Z"),
      actualEnd: new Date("2026-10-25T11:00:00Z"),
      status: MeetingStatus.QUEUED,
      language: "ar",
      audioSource: "upload",
      audioS3Key: `uploads/${aliceId}/${aliceMeetingId}/recording.mp3`,
      audioDurationSeconds: 600,
      audioDeletedAt: null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const bobMeeting: Meeting = {
      id: bobMeetingId,
      userId: bobId,
      title: "Bob Confidential Strategy",
      scheduledStart: new Date("2026-10-26T14:00:00Z"),
      scheduledEnd: new Date("2026-10-26T15:00:00Z"),
      actualStart: null,
      actualEnd: null,
      status: MeetingStatus.UPLOADED,
      language: "en",
      audioSource: "upload",
      audioS3Key: `uploads/${bobId}/${bobMeetingId}/bob.mp3`,
      audioDurationSeconds: null,
      audioDeletedAt: null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    meetingsStore.set(aliceMeetingId, aliceMeeting);
    meetingsStore.set(bobMeetingId, bobMeeting);

    // Initial usage events
    usageEventsStore.push({
      id: "ev-1",
      userId: aliceId,
      meetingId: aliceMeetingId,
      operationType: "AUDIO_TRANSCRIPTION",
      quantity: 10,
      unit: "minutes",
      costMicros: 200000n,
      metadata: { provider: "fake" },
      createdAt: new Date(),
    });

    usageEventsStore.push({
      id: "ev-2",
      userId: aliceId,
      meetingId: aliceMeetingId,
      operationType: "LLM_ANALYSIS",
      quantity: 5000,
      unit: "tokens",
      costMicros: 75000n,
      metadata: { provider: "fake" },
      createdAt: new Date(),
    });

    embeddingsStore.push(
      { meetingId: aliceMeetingId, text: "embedding text 1" },
      { meetingId: aliceMeetingId, text: "embedding text 2" },
      { meetingId: bobMeetingId, text: "bob embedding text" },
    );

    const mockPrisma = {
      user: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === aliceId) {
            return Promise.resolve({
              id: aliceId,
              email: "alice@example.com",
              name: "Alice Founder",
              role: Role.OWNER,
              createdAt: new Date(),
              updatedAt: new Date(),
              meetings: [aliceMeeting],
            });
          }
          if (where.id === bobId) {
            return Promise.resolve({
              id: bobId,
              email: "bob@example.com",
              name: "Bob Client",
              role: Role.OWNER,
              createdAt: new Date(),
              updatedAt: new Date(),
              meetings: [bobMeeting],
            });
          }
          return Promise.resolve(null);
        }),
        delete: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          return Promise.resolve({ id: where.id });
        }),
      },
      userSettings: {
        findUnique: vi.fn().mockResolvedValue({
          userId: aliceId,
          language: "ar",
          timezone: "Africa/Cairo",
          audioRetentionDays: 7,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        upsert: vi.fn().mockImplementation(({ create, update }) => {
          return Promise.resolve({ ...create, ...update, id: "settings-1" });
        }),
      },
      recordingConsent: {
        findFirst: vi.fn().mockResolvedValue({ id: "consent-1", userId: aliceId }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "c-1", ...data })),
      },
      meeting: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          return Promise.resolve(meetingsStore.get(where.id) ?? null);
        }),
        findMany: vi.fn().mockImplementation(({ where }: { where: { userId?: string } }) => {
          const res = Array.from(meetingsStore.values()).filter(
            (m) => !where?.userId || m.userId === where.userId,
          );
          return Promise.resolve(res);
        }),
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const item = { id: `mtg-${Date.now()}`, ...data };
          meetingsStore.set(item.id, item);
          return Promise.resolve(item);
        }),
        update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) => {
          const existing = meetingsStore.get(where.id);
          if (!existing) throw new Error("Not found");
          const updated = { ...existing, ...data };
          meetingsStore.set(where.id, updated);
          return Promise.resolve(updated);
        }),
        delete: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          const existing = meetingsStore.get(where.id);
          meetingsStore.delete(where.id);
          return Promise.resolve(existing);
        }),
      },
      creditLedger: {
        upsert: vi.fn().mockImplementation(({ where, create, update }: any) => {
          const existing = ledgersStore.get(where.userId);
          if (existing) {
            const updated: CreditLedger = {
              ...existing,
              balanceMicros:
                update.balanceMicros?.increment !== undefined
                  ? existing.balanceMicros + update.balanceMicros.increment
                  : existing.balanceMicros,
              reservedMicros:
                update.reservedMicros?.increment !== undefined
                  ? existing.reservedMicros + update.reservedMicros.increment
                  : existing.reservedMicros,
              updatedAt: new Date(),
            };
            ledgersStore.set(where.userId, updated);
            return Promise.resolve(updated);
          }
          const created: CreditLedger = {
            id: `ledger-${where.userId}`,
            userId: where.userId,
            balanceMicros: create.balanceMicros ?? 0n,
            reservedMicros: create.reservedMicros ?? 0n,
            updatedAt: new Date(),
          };
          ledgersStore.set(where.userId, created);
          return Promise.resolve(created);
        }),
        findUnique: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
          return Promise.resolve(ledgersStore.get(where.userId) ?? null);
        }),
        update: vi.fn().mockImplementation(({ where, data }: any) => {
          const existing = ledgersStore.get(where.userId);
          if (!existing) throw new Error("Ledger not found");
          const updated: CreditLedger = {
            ...existing,
            balanceMicros:
              data.balanceMicros?.decrement !== undefined
                ? existing.balanceMicros - data.balanceMicros.decrement
                : existing.balanceMicros,
            reservedMicros:
              data.reservedMicros?.increment !== undefined
                ? existing.reservedMicros + data.reservedMicros.increment
                : data.reservedMicros?.decrement !== undefined
                  ? existing.reservedMicros - data.reservedMicros.decrement
                  : existing.reservedMicros,
            updatedAt: new Date(),
          };
          ledgersStore.set(where.userId, updated);
          return Promise.resolve(updated);
        }),
        updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
          const existing = ledgersStore.get(where.userId);
          if (existing) {
            const updated = {
              ...existing,
              balanceMicros:
                data.balanceMicros?.decrement !== undefined
                  ? existing.balanceMicros - data.balanceMicros.decrement
                  : existing.balanceMicros,
            };
            ledgersStore.set(where.userId, updated);
          }
          return Promise.resolve({ count: 1 });
        }),
      },
      creditTransaction: {
        create: vi.fn().mockImplementation(({ data }: any) => {
          const item: CreditTransaction = {
            id: `tx-${transactionsStore.length + 1}`,
            ...data,
            createdAt: new Date(),
          };
          transactionsStore.push(item);
          return Promise.resolve(item);
        }),
        findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
          return Promise.resolve(
            transactionsStore.filter((t) => t.userId === where.userId),
          );
        }),
      },
      usageEvent: {
        create: vi.fn().mockImplementation(({ data }: any) => {
          const item = { id: `ev-${usageEventsStore.length + 1}`, ...data };
          usageEventsStore.push(item);
          return Promise.resolve(item);
        }),
        findMany: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
          return Promise.resolve(
            usageEventsStore.filter((ev) => ev.userId === where.userId),
          );
        }),
      },
      meetingEmbedding: {
        deleteMany: vi.fn().mockImplementation(({ where }: any) => {
          const initialLen = embeddingsStore.length;
          if (where.meetingId?.in) {
            const set = new Set(where.meetingId.in);
            for (let i = embeddingsStore.length - 1; i >= 0; i--) {
              if (set.has(embeddingsStore[i]!.meetingId)) {
                embeddingsStore.splice(i, 1);
              }
            }
          } else if (where.meetingId) {
            for (let i = embeddingsStore.length - 1; i >= 0; i--) {
              if (embeddingsStore[i]!.meetingId === where.meetingId) {
                embeddingsStore.splice(i, 1);
              }
            }
          }
          return Promise.resolve({ count: initialLen - embeddingsStore.length });
        }),
      },
      proposal: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      followUpDraft: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      reminder: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      calendarConnection: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      task: { findMany: vi.fn().mockResolvedValue([]) },
      decision: { findMany: vi.fn().mockResolvedValue([]) },
      agendaItem: { findMany: vi.fn().mockResolvedValue([]) },
      topicDiscussion: { findMany: vi.fn().mockResolvedValue([]) },
      openQuestion: { findMany: vi.fn().mockResolvedValue([]) },
      documentReference: { findMany: vi.fn().mockResolvedValue([]) },
      meetingParticipant: { findMany: vi.fn().mockResolvedValue([]) },
      transcriptSegment: { findMany: vi.fn().mockResolvedValue([]) },
      meetingAnalysis: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockImplementation((fn: any) => {
        if (typeof fn === "function") return fn(mockPrisma);
        return Promise.all(fn);
      }),
    } as unknown as PrismaClient;

    const auth = new LocalAuthProvider(mockPrisma, secret);
    const aliceTokens = await auth.issueTokens({
      id: aliceId,
      email: "alice@example.com",
      name: "Alice Founder",
      role: Role.OWNER,
    });
    aliceToken = aliceTokens.accessToken;

    const bobTokens = await auth.issueTokens({
      id: bobId,
      email: "bob@example.com",
      name: "Bob Client",
      role: Role.OWNER,
    });
    bobToken = bobTokens.accessToken;

    const creditRepo = new CreditRepository(mockPrisma);
    const meetingRepo = new MeetingRepository(mockPrisma);
    const paymentProvider = new ManualPaymentAdapter(creditRepo);
    const dataManagementService = new DataManagementService({
      prisma: mockPrisma,
      meetingRepository: meetingRepo,
      s3Client: mockS3Client,
      bucketName: "test-audio-bucket",
    });

    app = await buildApp({
      corsOrigins: ["*"],
      appSecret: secret,
      prisma: mockPrisma,
      localAuthProvider: auth,
      paymentProvider,
      dataManagementService,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ==========================================
  // 1. Balance Gating before processing
  // ==========================================
  describe("Balance Gating before Processing", () => {
    it("rejects presigned upload URL with HTTP 402 when user has 0 credit balance", async () => {
      // Alice has no credits in ledger yet (0 balance)
      const res = await app.inject({
        method: "POST",
        url: `/api/meetings/${aliceMeetingId}/upload-url`,
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          fileName: "meeting.mp3",
          fileSizeBytes: 1024 * 1024,
          contentType: "audio/mp3",
          consentConfirmed: true,
        },
      });

      expect(res.statusCode).toBe(402);
      const body = res.json();
      expect(body.error).toBe("Insufficient credit balance");
      expect(body.message).toContain("positive credit balance");
    });

    it("worker pipeline fails meeting processing with clear reason when balance is 0", async () => {
      const mockPrisma = (app as any).prisma || {
        meeting: {
          findUnique: vi.fn().mockResolvedValue({
            id: aliceMeetingId,
            userId: aliceId,
            title: "Test Meeting",
            status: MeetingStatus.QUEUED,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        creditLedger: {
          findUnique: vi.fn().mockResolvedValue({
            userId: aliceId,
            balanceMicros: 0n,
            reservedMicros: 0n,
          }),
        },
        recordingConsent: {
          findFirst: vi.fn().mockResolvedValue({ id: "consent-1", userId: aliceId }),
        },
      };

      await expect(
        processMeetingAudio(
          {
            prisma: mockPrisma as any,
            s3Client: mockS3Client,
            asrClient: new FakeSpeechToText(),
            llmClient: new FakeLlmClient(),
            pricingConfig: {
              customerPricePerAudioMinuteMicros: 20000,
              providerCosts: {
                asrPerAudioMinuteMicros: {},
                llmPerMillionInputTokensMicros: {},
                llmPerMillionOutputTokensMicros: {},
                embeddingsPerMillionTokensMicros: {},
              },
              lowBalanceThresholdMicros: 100000,
            },
            asrProviderName: "fake",
            llmProviderName: "fake",
          },
          {
            meetingId: aliceMeetingId,
            userId: aliceId,
            s3Bucket: "test-audio-bucket",
            s3Key: "uploads/test.mp3",
          },
        ),
      ).rejects.toThrow(/Balance gate/);

      expect(mockPrisma.meeting.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: MeetingStatus.FAILED,
            failureReason: expect.stringContaining("Balance gate: insufficient credit balance"),
          }),
        }),
      );
    });
  });

  // ==========================================
  // 2. PaymentProvider & Credit Top-up
  // ==========================================
  describe("PaymentProvider (Manual Adapter) & Credit Top-up", () => {
    it("tops up credit balance via POST /api/billing/topup", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/topup",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          amountDollars: 10.0, // $10 = 10,000,000 micros
          reference: "VOUCHER-DEPI-2026",
          description: "Manual voucher credit deposit",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.transaction.amountMicros).toBe("10000000");
      expect(body.transaction.newBalanceMicros).toBe("10000000");
      expect(body.transaction.formattedNewBalance).toBe("$10.00");
      expect(body.transaction.reference).toBe("VOUCHER-DEPI-2026");
    });

    it("allows upload after topping up credits", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/meetings/${aliceMeetingId}/upload-url`,
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          fileName: "meeting.mp3",
          fileSizeBytes: 1024 * 1024,
          contentType: "audio/mp3",
          consentConfirmed: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.uploadUrl).toBeDefined();
      expect(body.s3Key).toContain(`uploads/${aliceId}/${aliceMeetingId}/meeting.mp3`);
    });

    it("rejects non-positive topup amounts", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/billing/topup",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          amountDollars: -5.0,
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ==========================================
  // 3. Billing Ledger & Usage Retrieval
  // ==========================================
  describe("Billing Balance, Transactions, and Usage API", () => {
    it("returns formatted balance via GET /api/billing/balance", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/billing/balance",
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.currency).toBe("USD");
      expect(body.availableMicros).toBe("10000000");
      expect(body.formattedBalance).toBe("$10.00");
    });

    it("returns transactions ledger via GET /api/billing/transactions", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/billing/transactions",
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.transactions)).toBe(true);
      expect(body.transactions.length).toBeGreaterThan(0);
      expect(body.transactions[0].transactionType).toBe(CreditTransactionType.CREDIT_TOPUP);
    });

    it("returns usage events and aggregated summary via GET /api/billing/usage", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/billing/usage",
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.summary).toBeDefined();
      expect(body.summary.totalAudioMinutes).toBe(10);
      expect(body.summary.totalLlmTokens).toBe(5000);
      expect(body.summary.totalCostDollars).toBe(0.275);
      expect(body.events.length).toBe(2);
    });
  });

  // ==========================================
  // 4. Real Data Deletion (DB rows, embeddings, S3 objects)
  // ==========================================
  describe("Real Data Deletion (DB rows, embeddings, S3 objects)", () => {
    it("deletes meeting, deletes embeddings, and calls S3 DeleteObject", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/meetings/${aliceMeetingId}`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.deletedMeetingId).toBe(aliceMeetingId);
      expect(body.audioDeletedFromS3).toBe(true);

      // Verify S3 DeleteObject was called with Alice's audio key
      expect(s3DeletedKeys).toContain(`uploads/${aliceId}/${aliceMeetingId}/meeting.mp3`);

      // Verify meeting no longer exists in repository
      expect(meetingsStore.has(aliceMeetingId)).toBe(false);

      // Verify embeddings were removed
      const remainingEmbeddings = embeddingsStore.filter((e) => e.meetingId === aliceMeetingId);
      expect(remainingEmbeddings.length).toBe(0);
    });

    it("deletes user account and all associated meetings and S3 audio", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/settings/account",
        headers: { authorization: `Bearer ${bobToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.details.deletedUserId).toBe(bobId);

      // Verify Bob's S3 audio was deleted
      expect(s3DeletedKeys).toContain(`uploads/${bobId}/${bobMeetingId}/bob.mp3`);
    });
  });

  // ==========================================
  // 5. Data Export
  // ==========================================
  describe("Data Export (Full JSON Package)", () => {
    it("exports complete user profile, settings, meetings, ledger, and usage via GET /api/settings/export", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/settings/export",
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-disposition"]).toContain("attachment; filename=");
      const data = res.json();
      expect(data.metadata.format).toBe("dawwen-account-export");
      expect(data.user.email).toBe("alice@example.com");
      expect(data.settings.timezone).toBe("Africa/Cairo");
      expect(Array.isArray(data.creditTransactions)).toBe(true);
      expect(Array.isArray(data.usageEvents)).toBe(true);
      expect(Array.isArray(data.meetings)).toBe(true);
    });
  });

  // ==========================================
  // 6. Settings API
  // ==========================================
  describe("Settings Management", () => {
    it("updates settings including immediate audio deletion (0 retention days)", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          language: "en",
          timezone: "UTC",
          audioRetentionDays: 0, // 0 = delete immediately after transcription
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.settings.language).toBe("en");
      expect(body.settings.timezone).toBe("UTC");
      expect(body.settings.audioRetentionDays).toBe(0);
    });
  });

  // ==========================================
  // 7. Tenant Isolation
  // ==========================================
  describe("Tenant Isolation for Billing and Data", () => {
    it("prevents Bob from viewing Alice's billing balance or transactions", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/billing/transactions",
        headers: { authorization: `Bearer ${bobToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Bob should have 0 transactions; none of Alice's transactions may leak
      expect(body.transactions.length).toBe(0);
    });

    it("prevents Bob from deleting Alice's meeting", async () => {
      // Create a temporary meeting for Alice
      const tempMeetingId = "mtg-alice-temp-999";
      meetingsStore.set(tempMeetingId, {
        id: tempMeetingId,
        userId: aliceId,
        title: "Alice Private Meeting",
        scheduledStart: null,
        scheduledEnd: null,
        actualStart: null,
        actualEnd: null,
        status: MeetingStatus.APPROVED,
        language: "ar",
        audioSource: "upload",
        audioS3Key: null,
        audioDurationSeconds: 100,
        audioDeletedAt: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/meetings/${tempMeetingId}`,
        headers: { authorization: `Bearer ${bobToken}` },
      });

      // Meeting belongs to Alice, so Bob should receive 403 or error
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(meetingsStore.has(tempMeetingId)).toBe(true);
    });
  });
});
