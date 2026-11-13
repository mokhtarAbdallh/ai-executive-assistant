import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CrossTenantAccessViolationError,
  ProposalActionType,
  ProposalStatus,
  type PrismaClient,
} from "@dawwen/db";
import type { AgentChatModel, AgentConverseRequest, AgentTurn } from "@dawwen/llm";
import { AgentService } from "../src/services/agent.js";
import { zonedTimeToUtc, formatInZone } from "../src/services/timezone.js";

/** ADR-024: Bedrock tool loop, Cairo dates, proposals only, metered tokens. */
describe("Ask assistant with a tool-using model", () => {
  const ctx = { userId: "u1" };
  const NOW = new Date("2026-11-13T08:00:00.000Z"); // Friday 10:00 in Cairo

  const proposals: Array<Record<string, unknown>> = [];
  const usage: Array<Record<string, unknown>> = [];
  const deps = {
    search: { search: vi.fn() },
    tasks: { listByMeeting: vi.fn() },
    proposals: {
      createPending: vi.fn(async (_c: unknown, data: Record<string, unknown>) => {
        const p = {
          id: `p${proposals.length + 1}`,
          status: ProposalStatus.PENDING_APPROVAL,
          ...data,
        };
        proposals.push(p);
        return p;
      }),
    },
    drafts: { create: vi.fn(async (_c: unknown, d: object) => ({ id: "d1", ...d })) },
    meetings: {
      findById: vi.fn(async (_c: unknown, id: string) => {
        if (id === "m-other") throw new CrossTenantAccessViolationError(id, "u1", "Meeting");
        return id === "m1" ? { id: "m1", title: "Sprint review" } : null;
      }),
      list: vi.fn(async () => [{ id: "m1", title: "Sprint review" }]),
    },
  };
  const prisma = {
    userSettings: { findUnique: vi.fn(async () => ({ timezone: "Africa/Cairo" })) },
    usageEvent: { create: vi.fn(async ({ data }: { data: object }) => usage.push(data)) },
  } as unknown as PrismaClient;

  /** Model that plays back a script of turns and records what it was sent. */
  function scriptedModel(turns: Array<Omit<AgentTurn, "modelName">>) {
    const requests: AgentConverseRequest[] = [];
    const model: AgentChatModel = {
      providerName: "bedrock",
      converse: vi.fn(async (req: AgentConverseRequest) => {
        requests.push(structuredClone(req));
        const next = turns.shift();
        if (!next) throw new Error("model called too often");
        return { ...next, modelName: "claude-test" };
      }),
    };
    return { model, requests };
  }

  const service = (model: AgentChatModel) =>
    new AgentService(
      deps.search as never,
      deps.tasks as never,
      deps.proposals as never,
      deps.drafts as never,
      {} as never,
      deps.meetings as never,
      {
        chatModel: model,
        prisma,
        now: () => NOW,
        pricing: {
          customerPricePerAudioMinuteMicros: 0,
          lowBalanceThresholdMicros: 0,
          providerCosts: {
            asrPerAudioMinuteMicros: {},
            llmPerMillionInputTokensMicros: { bedrock: 3_000_000 },
            llmPerMillionOutputTokensMicros: { bedrock: 15_000_000 },
            embeddingsPerMillionTokensMicros: {},
          },
        },
      },
    );

  const toolTurn = (name: string, input: unknown, id = "t1") => ({
    stopReason: "tool_use" as const,
    content: [{ type: "tool_use" as const, id, name, input }],
    inputTokens: 1000,
    outputTokens: 100,
  });
  const textTurn = (text: string) => ({
    stopReason: "end_turn" as const,
    content: [{ type: "text" as const, text }],
    inputTokens: 1200,
    outputTokens: 80,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    proposals.length = 0;
    usage.length = 0;
  });

  it("answers from search results with their citations and meters every model call", async () => {
    deps.search.search.mockResolvedValue([
      {
        meetingId: "m1",
        meetingTitle: "Sprint review",
        timestamp: "[03:10]",
        text: "اتفقنا على سعر الباقة 300 جنيه",
        score: 0.9,
        matchType: "hybrid",
      },
    ]);
    const { model, requests } = scriptedModel([
      toolTurn("search_meetings", { query: "سعر الباقة" }),
      textTurn('السعر 300 جنيه [03:10] في "Sprint review".'),
    ]);

    const res = await service(model).processQuery(ctx, { query: "السعر كام؟" });

    expect(res.answer).toContain("[03:10]");
    expect(res.citations).toHaveLength(1);
    expect(res.toolsUsed).toEqual(["search_meetings"]);
    expect(res.honestUnknown).toBe(false);
    // The tool result went back to the model.
    expect(JSON.stringify(requests[1]!.messages)).toContain("اتفقنا على سعر الباقة");
    // The system prompt carries today's date in Cairo.
    expect(requests[0]!.system).toContain("2026-11-13 10:00");
    // Invariant 7: one usage row per model call, with real cost.
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      operationType: "LLM_CHAT",
      quantity: 1100,
      costMicros: 4500n,
    });
  });

  it("flags an honest unknown when the search finds nothing", async () => {
    deps.search.search.mockResolvedValue([
      { meetingId: "m1", meetingTitle: "x", timestamp: "[00:01]", text: "noise", score: 0.1 },
    ]);
    const { model } = scriptedModel([
      toolTurn("search_meetings", { query: "satellite budget" }),
      textTurn("This was not mentioned in your meetings."),
    ]);

    const res = await service(model).processQuery(ctx, { query: "satellite budget?" });

    expect(res.honestUnknown).toBe(true);
    expect(res.citations).toHaveLength(0);
  });

  it("propose_event turns a Cairo wall-clock time into UTC and only creates a proposal", async () => {
    const { model } = scriptedModel([
      toolTurn("propose_event", {
        title: "متابعة الإطلاق",
        date: "2026-11-17",
        time: "14:30",
        durationMinutes: 45,
      }),
      textTurn("جهزت مقترح الاجتماع ومستني موافقتك."),
    ]);

    const res = await service(model).processQuery(ctx, {
      query: "احجز متابعة الثلاثاء الساعة 2:30",
      meetingId: "m1",
    });

    expect(res.proposalsCreated).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      actionType: ProposalActionType.SCHEDULE_MEETING,
      status: ProposalStatus.PENDING_APPROVAL,
      meetingId: "m1",
      payload: expect.objectContaining({
        proposedDatetime: "2026-11-17T12:30:00.000Z", // Cairo is UTC+2 in November
        durationMinutes: 45,
        needsReview: false,
      }),
    });
  });

  it("never invents a time: without date/time the proposal is flagged for review", async () => {
    const { model, requests } = scriptedModel([
      toolTurn("propose_event", { title: "Follow-up" }),
      textTurn("Proposal ready; add the day and time before approving."),
    ]);

    await service(model).processQuery(ctx, { query: "book a follow-up" });

    expect(proposals[0]!.payload).toMatchObject({ proposedDatetime: null, needsReview: true });
    expect(JSON.stringify(requests[1]!.messages)).toContain('"missing":["date","time"]');
  });

  it("refuses past times and other users' meetings as tool errors, creating nothing", async () => {
    const { model, requests } = scriptedModel([
      {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "a",
            name: "propose_event",
            input: { title: "x", date: "2026-11-01", time: "09:00" },
          },
          {
            type: "tool_use",
            id: "b",
            name: "draft_message",
            input: { meetingId: "m-other", subject: "s", body: "b" },
          },
        ],
        inputTokens: 10,
        outputTokens: 10,
      },
      textTurn("I could not do that."),
    ]);

    const res = await service(model).processQuery(ctx, { query: "do things" });

    expect(res.proposalsCreated).toHaveLength(0);
    expect(deps.drafts.create).not.toHaveBeenCalled();
    const toolResults = JSON.stringify(requests[1]!.messages.at(-1));
    expect(toolResults).toContain("in the past");
    expect(toolResults).toContain("Meeting not found");
    expect(toolResults).toContain('"isError":true');
  });

  it("draft_message keeps an unknown recipient empty instead of a placeholder", async () => {
    const { model } = scriptedModel([
      toolTurn("draft_message", { subject: "Notes", body: "Here are the notes" }),
      textTurn("Draft saved; add the recipient before approving."),
    ]);

    const res = await service(model).processQuery(ctx, {
      query: "draft the notes",
      meetingId: "m1",
    });

    expect(res.draftsCreated).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      actionType: ProposalActionType.DRAFT_EMAIL,
      payload: expect.objectContaining({ recipientEmail: null, needsReview: true }),
    });
  });

  it("stops after a bounded number of tool rounds", async () => {
    deps.search.search.mockResolvedValue([]);
    const { model } = scriptedModel(
      Array.from({ length: 6 }, (_, i) => toolTurn("search_meetings", { query: `q${i}` }, `t${i}`)),
    );

    const res = await service(model).processQuery(ctx, { query: "loop forever" });

    expect(model.converse).toHaveBeenCalledTimes(6);
    expect(res.answer).toMatch(/could not finish/);
  });
});

describe("time zone helpers", () => {
  it("converts Cairo wall-clock time to UTC in winter and summer (DST)", () => {
    expect(zonedTimeToUtc("2026-01-15", "09:00", "Africa/Cairo")?.toISOString()).toBe(
      "2026-01-15T07:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-07-15", "09:00", "Africa/Cairo")?.toISOString()).toBe(
      "2026-07-15T06:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-13-40", "09:00", "Africa/Cairo")).toBeNull();
  });

  it("formats an instant in the user's zone", () => {
    const text = formatInZone(new Date("2026-11-17T12:30:00Z"), "Africa/Cairo", "en");
    expect(text).toContain("17 November 2026");
    expect(text).toContain("14:30");
  });
});
