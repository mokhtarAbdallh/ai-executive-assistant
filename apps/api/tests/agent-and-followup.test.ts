import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { LocalAuthProvider } from "../src/auth/local.provider.js";
import { Role, ProposalActionType, ProposalStatus, ReminderStatus } from "@dawwen/db";
import type { Proposal, PrismaClient, FollowUpDraft, Reminder, Meeting } from "@dawwen/db";
import { FakeCalendarProvider } from "../src/services/calendar.js";

describe("Phase 5: Follow-up & Ask Chat Agent Invariants", () => {
  let app: FastifyInstance;
  let aliceToken: string;
  let fakeCalendar: FakeCalendarProvider;

  const aliceId = "usr-alice-phase5";
  const meetingId = "mtg-phase5-001";
  const secret = "test-jwt-secret-at-least-32-chars-long!";

  const proposalsStore = new Map<string, Proposal>();
  const draftsStore = new Map<string, FollowUpDraft>();
  const remindersStore = new Map<string, Reminder>();

  const testMeeting: Meeting = {
    id: meetingId,
    userId: aliceId,
    title: "اجتماع إطلاق منصة دوّن وتسعير الباقات",
    scheduledStart: new Date("2026-10-25T10:00:00Z"),
    scheduledEnd: new Date("2026-10-25T11:00:00Z"),
    actualStart: new Date("2026-10-25T10:00:00Z"),
    actualEnd: new Date("2026-10-25T11:00:00Z"),
    status: "APPROVED" as any,
    language: "ar",
    audioSource: "upload",
    audioS3Key: "uploads/test.mp3",
    audioDurationSeconds: 1800,
    audioDeletedAt: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const testSegments = [
    {
      id: "seg-1",
      meetingId,
      speakerLabel: "مختار",
      startMs: 15000,
      endMs: 32000,
      text: "قررنا إطلاق النسخة التجريبية يوم الأحد القادم وتسعير باقة البرو بـ 49 دولار شهرياً",
      language: "ar",
      confidence: 0.98,
      createdAt: new Date(),
      meeting: { id: meetingId, title: testMeeting.title },
    },
    {
      id: "seg-2",
      meetingId,
      speakerLabel: "سارة",
      startMs: 45000,
      endMs: 65000,
      text: "سارة مسؤولة عن تجهيز شاشات المتابعة وتذكيرات المهام قبل نهاية الأسبوع",
      language: "ar",
      confidence: 0.95,
      createdAt: new Date(),
      meeting: { id: meetingId, title: testMeeting.title },
    },
  ];

  const testDecisions = [
    {
      id: "dec-1",
      meetingId,
      text: "اعتماد سعر 49 دولار شهرياً لباقة البرو",
      sourceTs: "[00:15]",
      sourceSegmentIds: ["seg-1"],
      confidence: 0.99,
      approved: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      meeting: { id: meetingId, title: testMeeting.title },
    },
  ];

  const testTasks = [
    {
      id: "task-1",
      meetingId,
      title: "تجهيز شاشات المتابعة وتذكيرات المهام",
      description: null,
      ownerName: "سارة",
      ownerEmail: "sara@dawwen.ai",
      dueDate: new Date("2026-10-30T18:00:00Z"),
      priority: "HIGH" as any,
      status: "NEW" as any,
      sourceTs: "[00:45]",
      sourceSegmentIds: ["seg-2"],
      confidence: 0.95,
      needsReview: false,
      approved: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockPrisma = {
    user: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === aliceId) {
          return Promise.resolve({
            id: aliceId,
            email: "alice@dawwen.ai",
            name: "Alice",
            role: Role.OWNER,
          });
        }
        return Promise.resolve(null);
      }),
    },
    meeting: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === meetingId) return Promise.resolve(testMeeting);
        return Promise.resolve(null);
      }),
      findMany: vi.fn().mockImplementation(() => Promise.resolve([testMeeting])),
    },
    transcriptSegment: {
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        const orClauses = where?.OR || [];
        const terms = orClauses
          .map((c: any) => c.text?.contains?.toLowerCase())
          .filter(Boolean);
        return Promise.resolve(
          testSegments.filter((s) => {
            if (terms.length === 0) return true;
            return terms.some((t: string) => s.text.toLowerCase().includes(t));
          }),
        );
      }),
    },
    decision: {
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        const queryText = where?.text?.contains?.toLowerCase() || "";
        return Promise.resolve(
          testDecisions.filter((d) => {
            if (!queryText) return true;
            const words = queryText.split(/\s+/).filter((w: string) => w.length > 2);
            return words.some((w: string) => d.text.toLowerCase().includes(w));
          }),
        );
      }),
    },
    topicDiscussion: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    task: {
      findMany: vi.fn().mockImplementation(({ where }: { where: { meetingId: string } }) => {
        if (where.meetingId === meetingId) return Promise.resolve(testTasks);
        return Promise.resolve([]);
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const t = testTasks.find((task) => task.id === where.id);
        if (!t) return Promise.resolve(null);
        return Promise.resolve({ ...t, meeting: { userId: aliceId } });
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const t = {
          id: `task-${Date.now()}`,
          meetingId: data.meeting.connect.id,
          title: data.title,
          ownerName: data.ownerName ?? null,
          dueDate: data.dueDate ?? null,
          priority: data.priority ?? "MEDIUM",
          status: "NEW",
          sourceTs: data.sourceTs ?? null,
          sourceSegmentIds: [],
          needsReview: data.needsReview ?? false,
          approved: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return Promise.resolve(t);
      }),
    },
    proposal: {
      create: vi.fn().mockImplementation(({ data }: any) => {
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
      findMany: vi.fn().mockImplementation(() => {
        return Promise.resolve(Array.from(proposalsStore.values()));
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const record = proposalsStore.get(where.id);
        if (!record) throw new Error("Proposal not found");
        const updated = { ...record, ...data, updatedAt: new Date() };
        proposalsStore.set(where.id, updated);
        return Promise.resolve(updated);
      }),
    },
    followUpDraft: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const record: FollowUpDraft = {
          id,
          meetingId: data.meetingId,
          recipientEmail: data.recipientEmail ?? null,
          recipientName: data.recipientName ?? null,
          channel: data.channel ?? "email",
          subject: data.subject ?? null,
          body: data.body,
          status: data.status ?? "draft",
          sentAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        draftsStore.set(id, record);
        return Promise.resolve(record);
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const d = draftsStore.get(where.id);
        if (!d) return Promise.resolve(null);
        return Promise.resolve({ ...d, meeting: { userId: aliceId } });
      }),
      findMany: vi.fn().mockImplementation(() => {
        return Promise.resolve(Array.from(draftsStore.values()));
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const d = draftsStore.get(where.id);
        if (!d) throw new Error("Draft not found");
        const updated = { ...d, ...data, updatedAt: new Date() };
        draftsStore.set(where.id, updated);
        return Promise.resolve(updated);
      }),
    },
    reminder: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        const id = `remind-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const record: Reminder = {
          id,
          userId: data.userId,
          meetingId: data.meetingId ?? null,
          taskId: data.taskId ?? null,
          remindAt: data.remindAt,
          channel: data.channel ?? "console",
          status: data.status ?? ReminderStatus.SCHEDULED,
          sentAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        remindersStore.set(id, record);
        return Promise.resolve(record);
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve(remindersStore.get(where.id) || null);
      }),
      findMany: vi.fn().mockImplementation(() => {
        return Promise.resolve(Array.from(remindersStore.values()));
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const r = remindersStore.get(where.id);
        if (!r) throw new Error("Reminder not found");
        const updated = { ...r, ...data, updatedAt: new Date() };
        remindersStore.set(where.id, updated);
        return Promise.resolve(updated);
      }),
    },
    calendarConnection: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };

  beforeAll(async () => {
    fakeCalendar = new FakeCalendarProvider();
    const localAuth = new LocalAuthProvider(mockPrisma as unknown as PrismaClient, secret);
    const tokens = await localAuth.issueTokens({
      id: aliceId,
      email: "alice@dawwen.ai",
      name: "Alice",
      role: Role.OWNER,
    });
    aliceToken = tokens.accessToken;

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

  // HARD INVARIANT 1: Action tools create Proposal rows ONLY
  describe("Hard Invariant 1: Action tools create Proposal rows ONLY", () => {
    it("propose_event tool creates a Proposal in PENDING_APPROVAL and does NOT book the calendar", async () => {
      const initialEvents = await fakeCalendar.listEvents(
        { accessToken: "" },
        { timeMin: new Date(0), timeMax: new Date(Date.now() + 1e12) },
      );
      const initialBookedEvents = initialEvents.length;

      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          query: "احجز اجتماع متابعة الأسبوع القادم لمراجعة الإطلاق",
          meetingId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.toolsUsed).toContain("propose_event");
      expect(body.proposalsCreated.length).toBe(1);

      const createdProp = body.proposalsCreated[0];
      expect(createdProp.actionType).toBe(ProposalActionType.SCHEDULE_MEETING);
      expect(createdProp.status).toBe(ProposalStatus.PENDING_APPROVAL);

      // Verify that calendar was NOT booked directly!
      const finalEvents = await fakeCalendar.listEvents(
        { accessToken: "" },
        { timeMin: new Date(0), timeMax: new Date(Date.now() + 1e12) },
      );
      expect(finalEvents.length).toBe(initialBookedEvents);
    });

    it("create_reminder tool creates a Proposal in PENDING_APPROVAL status", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          query: "فكرني بمراجعة تجهيزات شاشات المتابعة",
          meetingId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.toolsUsed).toContain("create_reminder");
      expect(body.proposalsCreated.length).toBe(1);

      const prop = body.proposalsCreated[0];
      expect(prop.actionType).toBe(ProposalActionType.SEND_REMINDER);
      expect(prop.status).toBe(ProposalStatus.PENDING_APPROVAL);
    });

    it("draft_message tool creates a draft and a Proposal for sending it", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          query: "اكتب مسودة رسالة للعميل عن محضر الاجتماع",
          meetingId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.toolsUsed).toContain("draft_message");
      expect(body.draftsCreated.length).toBe(1);
      expect(body.draftsCreated[0].status).toBe("draft");
      expect(body.proposalsCreated.length).toBe(1);
      expect(body.proposalsCreated[0].actionType).toBe(ProposalActionType.DRAFT_EMAIL);
      expect(body.proposalsCreated[0].status).toBe(ProposalStatus.PENDING_APPROVAL);
    });

    it("executes proposal ONLY after authenticated user approval", async () => {
      // Create a reminder proposal
      const propRes = await app.inject({
        method: "POST",
        url: "/api/reminders",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          meetingId,
          remindAt: new Date(Date.now() + 3600000).toISOString(),
          note: "تذكير معتمد بالاختبار",
          proposeOnly: true,
        },
      });

      expect(propRes.statusCode).toBe(201);
      const propData = propRes.json();
      expect(propData.isProposal).toBe(true);
      const proposalId = propData.proposal.id;

      // Approve & execute proposal
      const approveRes = await app.inject({
        method: "POST",
        url: `/api/proposals/${proposalId}/approve?execute=true`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(approveRes.statusCode).toBe(200);
      const approveData = approveRes.json();
      expect(approveData.execution.status).toBe(ProposalStatus.EXECUTED);
    });
  });

  // HARD INVARIANT 2: Source citations on every answer
  describe("Hard Invariant 2: Answers cite meeting + timestamp", () => {
    it("answers questions about meeting decisions with exact [MM:SS] citation", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          query: "ما هو سعر باقة البرو المتفق عليه؟",
          meetingId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.toolsUsed).toContain("search_meetings");
      expect(body.citations.length).toBeGreaterThan(0);

      // Verify citation format [MM:SS]
      const citation = body.citations[0];
      expect(citation.meetingId).toBe(meetingId);
      expect(citation.timestamp).toMatch(/\[\d{2}:\d{2}\]/);
      expect(body.answer).toContain(citation.timestamp);
    });

    it("get_tasks returns action items with owner and source timestamp", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          query: "ما هي المهام ومين المسؤول عنها؟",
          meetingId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.toolsUsed).toContain("get_tasks");
      expect(body.answer).toContain("سارة");
      expect(body.citations.length).toBeGreaterThan(0);
      expect(body.citations[0].timestamp).toBe("[00:45]");
    });
  });

  // HARD INVARIANT 3: Honesty on unknown queries
  describe("Hard Invariant 3: Honesty on unknown answers (No fabrication)", () => {
    it("explicitly states when information is not in the meetings", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          query: "ما هي تفاصيل إطلاق القمر الصناعي والميزانية الفضائية؟",
          meetingId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.honestUnknown).toBe(true);
      expect(body.citations).toHaveLength(0);
      expect(body.answer).toContain("لم يُذكر هذا الموضوع في الاجتماعات المتوفرة");
    });

    it("handles English unknown queries honestly without fabrication", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          query: "What is our quantum computing chip design roadmap?",
          meetingId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.honestUnknown).toBe(true);
      expect(body.citations).toHaveLength(0);
      expect(body.answer).toContain("This topic was not mentioned in the recorded meetings");
    });
  });

  // Hybrid Search Endpoint
  describe("GET /api/search (Hybrid Search)", () => {
    it("returns ranked citations with timestamps and relevance scores", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/search?q=تسعير",
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results[0].timestamp).toMatch(/\[\d{2}:\d{2}\]/);
      expect(body.results[0].score).toBeGreaterThan(0.5);
    });

    it("returns empty results for empty query", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/search?q=",
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().results).toEqual([]);
    });
  });

  // Follow-up Endpoints (Drafts & Reminders)
  describe("Follow-up Drafts & Reminders API", () => {
    it("creates, updates, and proposes sending a draft", async () => {
      // 1. Create draft
      const createRes = await app.inject({
        method: "POST",
        url: "/api/drafts",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          meetingId,
          recipientEmail: "client@acme.com",
          recipientName: "Acme Corp",
          subject: "متابعة اجتماع التسعير",
          body: "شكراً لاجتماع اليوم، نؤكد على الاتفاق.",
        },
      });

      expect(createRes.statusCode).toBe(201);
      const draft = createRes.json().draft;
      expect(draft.status).toBe("draft");

      // 2. Propose send (Hard Invariant 1: creates proposal)
      const propSendRes = await app.inject({
        method: "POST",
        url: `/api/drafts/${draft.id}/propose-send`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(propSendRes.statusCode).toBe(201);
      const sendProp = propSendRes.json().proposal;
      expect(sendProp.actionType).toBe(ProposalActionType.DRAFT_EMAIL);
      expect(sendProp.status).toBe(ProposalStatus.PENDING_APPROVAL);
    });

    it("cancels a scheduled reminder", async () => {
      // Create reminder directly
      const createRes = await app.inject({
        method: "POST",
        url: "/api/reminders",
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          meetingId,
          remindAt: new Date(Date.now() + 7200000).toISOString(),
          channel: "console",
          proposeOnly: false,
        },
      });

      expect(createRes.statusCode).toBe(201);
      const rem = createRes.json().reminder;

      // Cancel reminder
      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/reminders/${rem.id}/cancel`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.json().reminder.status).toBe(ReminderStatus.CANCELLED);
    });
  });
});
