import type {
  FollowUpDraft,
  FollowUpDraftRepository,
  MeetingRepository,
  PrismaClient,
  Proposal,
  ProposalRepository,
  ReminderRepository,
  TaskRepository,
  TenantContext,
} from "@dawwen/db";
import type { PricingConfig } from "@dawwen/config";
import type { AgentChatModel, AgentMessage, AgentUserBlock } from "@dawwen/llm";
import type { SearchCitation, SearchService } from "./search.js";
import {
  AGENT_TOOLS,
  ToolInputError,
  runAgentTool,
  type AgentToolDeps,
  type ToolContext,
  type ToolRunState,
} from "./agent-tools.js";
import { DEFAULT_TIMEZONE, formatInZone, isValidTimeZone, localDateTime } from "./timezone.js";

export interface AgentQueryInput {
  query: string;
  meetingId?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AgentResponse {
  answer: string;
  citations: SearchCitation[];
  proposalsCreated: Proposal[];
  draftsCreated: FollowUpDraft[];
  toolsUsed: string[];
  honestUnknown: boolean;
}

export interface AgentServiceOptions {
  /** Tool-using model (Bedrock). Without it a rule-based fallback answers (dev/demo). */
  chatModel?: AgentChatModel;
  /** For the user's time zone and for usage metering (Invariant 7). */
  prisma?: PrismaClient;
  pricing?: PricingConfig;
  now?: () => Date;
}

/** Tool round trips per question; enough for search → tasks → action. */
const MAX_MODEL_TURNS = 6;
const MAX_HISTORY_MESSAGES = 10;

function detectLanguage(text: string): "ar" | "en" {
  return /[؀-ۿ]/.test(text) || !/[a-zA-Z]/.test(text) ? "ar" : "en";
}

function systemPrompt(ctx: ToolContext): string {
  const { date, time } = localDateTime(ctx.now, ctx.timeZone);
  const today = formatInZone(ctx.now, ctx.timeZone, ctx.language);
  return `You are Dawwen's meeting assistant. Users hold meetings in Egyptian Arabic mixed with English.

Now: ${today} (${date} ${time}, time zone ${ctx.timeZone}). Resolve relative dates ("بكرة", "next Tuesday") from this date. All dates you show or pass to tools are in ${ctx.timeZone}.
${ctx.currentMeetingId ? `The user is looking at meeting ${ctx.currentMeetingId}; tools default to it.` : ""}

Rules:
- Facts about meetings come ONLY from tool results. Search before answering any question about what was said, decided or assigned.
- Cite every fact with its meeting title and [MM:SS] timestamp exactly as the tool returned it.
- If the tools return nothing relevant, say clearly that it was not mentioned in the recorded meetings. Never guess.
- Actions (draft_message, create_reminder, propose_event) only create proposals. Say that the proposal waits for the user's approval in the Proposals inbox; never claim something was sent, booked or scheduled.
- Never invent a date, time or email address. If the user did not give one, leave it out and tell them what to add before approving.
- Answer in ${ctx.language === "ar" ? "natural Egyptian Arabic (keep English technical terms as spoken)" : "English"}, short and readable: plain sentences or a short list, no JSON, no tool names.`;
}

export class AgentService {
  private readonly deps: AgentToolDeps;

  constructor(
    searchService: SearchService,
    taskRepository: TaskRepository,
    proposalRepository: ProposalRepository,
    draftRepository: FollowUpDraftRepository,
    private readonly reminderRepository: ReminderRepository,
    meetingRepository: MeetingRepository,
    private readonly options: AgentServiceOptions = {},
  ) {
    void this.reminderRepository;
    this.deps = {
      searchService,
      taskRepository,
      proposalRepository,
      draftRepository,
      meetingRepository,
    };
  }

  /**
   * Ask-chat entry point. Action tools ONLY create proposals (Invariant 1),
   * every answer is grounded in tool results with citations (Invariant 2) and
   * unknowns are said plainly (Invariant 3).
   */
  async processQuery(context: TenantContext, input: AgentQueryInput): Promise<AgentResponse> {
    const ctx: ToolContext = {
      tenant: context,
      timeZone: await this.userTimeZone(context.userId),
      language: detectLanguage(input.query),
      currentMeetingId: input.meetingId,
      now: this.options.now?.() ?? new Date(),
    };
    if (input.meetingId) {
      // 404 for another user's meeting (CrossTenantAccessViolationError → error handler).
      await this.deps.meetingRepository.findById(context, input.meetingId);
    }
    return this.options.chatModel
      ? this.runWithModel(this.options.chatModel, ctx, input)
      : this.runRuleBased(ctx, input.query.trim());
  }

  private async userTimeZone(userId: string): Promise<string> {
    let tz: string | undefined;
    try {
      const settings = await this.options.prisma?.userSettings.findUnique({
        where: { userId },
        select: { timezone: true },
      });
      tz = settings?.timezone;
    } catch {
      // Settings are a preference: fall back to the default zone.
    }
    return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  }

  /* ---------------- Bedrock tool loop ---------------- */

  private async runWithModel(
    model: AgentChatModel,
    ctx: ToolContext,
    input: AgentQueryInput,
  ): Promise<AgentResponse> {
    const state: ToolRunState = {
      citations: [],
      proposals: [],
      drafts: [],
      searchedWithoutEvidence: false,
    };
    const toolsUsed: string[] = [];

    const messages: AgentMessage[] = [];
    for (const h of (input.conversationHistory ?? []).slice(-MAX_HISTORY_MESSAGES)) {
      const text = h.content.slice(0, 4000);
      if (!text.trim()) continue;
      const last = messages[messages.length - 1];
      // Converse needs alternating roles starting with "user".
      if (!last && h.role === "assistant") continue;
      if (last?.role === h.role) continue;
      messages.push(
        h.role === "user"
          ? { role: "user", content: [{ type: "text", text }] }
          : { role: "assistant", content: [{ type: "text", text }] },
      );
    }
    if (messages[messages.length - 1]?.role === "user") messages.pop();
    messages.push({ role: "user", content: [{ type: "text", text: input.query.trim() }] });

    const system = systemPrompt(ctx);
    let answer = "";
    for (let turn = 0; turn < MAX_MODEL_TURNS; turn++) {
      const result = await model.converse({ system, messages, tools: AGENT_TOOLS });
      await this.meter(ctx.tenant.userId, model.providerName, result);

      messages.push({ role: "assistant", content: result.content });
      const toolUses = result.content.filter((b) => b.type === "tool_use");
      if (result.stopReason !== "tool_use" || toolUses.length === 0) {
        answer = result.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        break;
      }

      const results: AgentUserBlock[] = [];
      for (const use of toolUses) {
        if (!toolsUsed.includes(use.name)) toolsUsed.push(use.name);
        try {
          const content = await runAgentTool(use.name, use.input, this.deps, ctx, state);
          results.push({ type: "tool_result", toolUseId: use.id, content });
        } catch (err) {
          if (!(err instanceof ToolInputError)) throw err;
          results.push({
            type: "tool_result",
            toolUseId: use.id,
            content: { error: err.message },
            isError: true,
          });
        }
      }
      messages.push({ role: "user", content: results });
    }

    const nothingDone = state.proposals.length === 0 && state.drafts.length === 0;
    const honestUnknown =
      nothingDone && state.citations.length === 0 && state.searchedWithoutEvidence;
    if (!answer) {
      answer =
        ctx.language === "ar"
          ? "معرفتش أوصل لإجابة كاملة. جرّب تسأل بشكل أبسط أو حدد الاجتماع."
          : "I could not finish that answer. Try a simpler question or pick a meeting.";
    }

    return {
      answer,
      citations: state.citations.slice(0, 10),
      proposalsCreated: state.proposals,
      draftsCreated: state.drafts,
      toolsUsed,
      honestUnknown,
    };
  }

  /** Invariant 7: every model call is a usage event with its real cost. */
  private async meter(
    userId: string,
    provider: string,
    turn: { inputTokens: number; outputTokens: number; modelName: string },
  ): Promise<void> {
    const prisma = this.options.prisma;
    if (!prisma) return;
    const costs = this.options.pricing?.providerCosts;
    const inPerM = costs?.llmPerMillionInputTokensMicros[provider] ?? 0;
    const outPerM = costs?.llmPerMillionOutputTokensMicros[provider] ?? 0;
    const cost = Math.round((turn.inputTokens * inPerM + turn.outputTokens * outPerM) / 1_000_000);
    await prisma.usageEvent.create({
      data: {
        userId,
        operationType: "LLM_CHAT",
        quantity: turn.inputTokens + turn.outputTokens,
        unit: "tokens",
        costMicros: BigInt(cost),
        metadata: {
          provider,
          model: turn.modelName,
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
        },
      },
    });
  }

  /* ---------------- Rule-based fallback (no model configured) ---------------- */

  private async runRuleBased(ctx: ToolContext, query: string): Promise<AgentResponse> {
    const lower = query.toLowerCase();
    const isAr = ctx.language === "ar";
    const state: ToolRunState = {
      citations: [],
      proposals: [],
      drafts: [],
      searchedWithoutEvidence: false,
    };
    const respond = (tool: string, answer: string, honestUnknown = false): AgentResponse => ({
      answer,
      citations: state.citations,
      proposalsCreated: state.proposals,
      draftsCreated: state.drafts,
      toolsUsed: [tool],
      honestUnknown,
    });
    const has = (...words: string[]) => words.some((w) => lower.includes(w));

    // Without a model nothing can read a date out of free text, so action
    // proposals are created WITHOUT one and the user adds it before approving.
    if (has("احجز", "اقترح اجتماع", "موعد جديد", "propose meeting", "book meeting", "schedule")) {
      const title =
        query.replace(/.*?(احجز|اقترح|schedule|book)\s+/i, "").trim() ||
        (isAr ? "اجتماع متابعة" : "Follow-up meeting");
      await runAgentTool("propose_event", { title }, this.deps, ctx, state);
      return respond(
        "propose_event",
        isAr
          ? `جهزت مقترح اجتماع "${title}". حدد اليوم والساعة في صندوق المقترحات وبعدها وافق عليه عشان يتحجز.`
          : `I prepared a proposal for "${title}". Add the day and time in the Proposals inbox, then approve it to book.`,
      );
    }

    if (has("فكرني", "تذكير", "reminder", "remind me")) {
      const note =
        query.replace(/.*?(فكرني ب|فكرني|تذكير ب|remind me to)\s*/i, "").trim() ||
        (isAr ? "متابعة مخرجات الاجتماع" : "Follow up on the meeting");
      await runAgentTool("create_reminder", { note }, this.deps, ctx, state);
      return respond(
        "create_reminder",
        isAr
          ? `جهزت مقترح تذكير: "${note}". حدد وقته في صندوق المقترحات ووافق عليه عشان يتفعّل.`
          : `I prepared a reminder proposal: "${note}". Set its time in the Proposals inbox and approve it.`,
      );
    }

    if (has("اكتب مسودة", "مسودة رسالة", "مسودة إيميل", "draft email", "draft message")) {
      if (!ctx.currentMeetingId) {
        return respond(
          "draft_message",
          isAr ? "افتح الاجتماع اللي عاوز تكتب عنه المتابعة الأول." : "Open the meeting first.",
        );
      }
      await runAgentTool(
        "draft_message",
        {
          subject: isAr ? "متابعة مخرجات الاجتماع" : "Meeting follow-up",
          body: isAr
            ? "أهلاً،\n\nشكراً على الاجتماع. دي أهم النقاط اللي اتفقنا عليها والمهام الجاية.\n\nتحياتي"
            : "Hi,\n\nThanks for the meeting. Here are the key points we agreed on and the next steps.\n\nBest regards",
        },
        this.deps,
        ctx,
        state,
      );
      return respond(
        "draft_message",
        isAr
          ? 'المسودة اتحفظت في تبويب "المتابعة"، ومعاها مقترح إرسال. ضيف إيميل المستلم قبل ما توافق.'
          : 'The draft is saved in the "Follow-up" tab with a send proposal. Add the recipient email before approving.',
      );
    }

    if (has("مهام", "المهام", "tasks", "action items", "مين هيعمل", "who is doing")) {
      const result = (await runAgentTool("get_tasks", {}, this.deps, ctx, state)) as {
        tasks: Array<{
          title: string;
          owner: string | null;
          due: string | null;
          sourceTimestamp: string | null;
        }>;
      };
      if (result.tasks.length === 0) {
        return respond(
          "get_tasks",
          isAr ? "مفيش مهام متسجلة للاجتماع ده." : "No tasks were found for this meeting.",
        );
      }
      const unknown = isAr ? "غير محدد" : "unassigned";
      const lines = result.tasks.map((t, i) => {
        const owner = `${isAr ? "المسؤول" : "owner"}: ${t.owner ?? unknown}`;
        const due = t.due ? ` · ${isAr ? "الموعد" : "due"}: ${t.due}` : "";
        const ts = t.sourceTimestamp ? ` ${t.sourceTimestamp}` : "";
        return `${i + 1}. ${t.title} (${owner}${due})${ts}`;
      });
      return respond(
        "get_tasks",
        `${isAr ? "دي المهام المسجلة:" : "Here are the tasks:"}\n${lines.join("\n")}`,
      );
    }

    await runAgentTool("search_meetings", { query }, this.deps, ctx, state);
    if (state.citations.length === 0) {
      return respond(
        "search_meetings",
        isAr
          ? "لم يُذكر هذا الموضوع في الاجتماعات المتوفرة. ملقتش أي جزء في التفريغ أو القرارات له علاقة بالسؤال ده."
          : "This topic was not mentioned in the recorded meetings. I found no transcript passage or decision about it.",
        true,
      );
    }
    state.citations = state.citations.slice(0, 3);
    const snippets = state.citations.map((c) => `• ${c.timestamp} "${c.meetingTitle}": ${c.text}`);
    return respond(
      "search_meetings",
      isAr
        ? `ده اللي اتقال في الاجتماعات عن الموضوع:\n\n${snippets.join("\n\n")}`
        : `Here is what the meetings say about it:\n\n${snippets.join("\n\n")}`,
    );
  }
}
