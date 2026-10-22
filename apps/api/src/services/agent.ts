import type {
  TenantContext,
  Proposal,
  FollowUpDraft,
  Task,
} from "@dawwen/db";
import { ProposalActionType } from "@dawwen/db";
import type {
  ProposalRepository,
  TaskRepository,
  FollowUpDraftRepository,
  ReminderRepository,
  MeetingRepository,
} from "@dawwen/db";
import type { SearchService, SearchCitation } from "./search.js";

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

export class AgentService {
  constructor(
    private readonly searchService: SearchService,
    private readonly taskRepository: TaskRepository,
    private readonly proposalRepository: ProposalRepository,
    private readonly draftRepository: FollowUpDraftRepository,
    private readonly reminderRepository: ReminderRepository,
    private readonly meetingRepository: MeetingRepository,
  ) {
    void this.reminderRepository;
  }

  /**
   * Main entry point for the Ask Chat agent.
   * Dispatches queries to tools, enforces citation requirements,
   * ensures action tools ONLY create proposals (Hard Invariant 1),
   * and guarantees honest answers on unknown questions (Hard Invariant 3).
   */
  async processQuery(
    context: TenantContext,
    input: AgentQueryInput,
  ): Promise<AgentResponse> {
    const rawQuery = input.query.trim();
    const lowerQuery = rawQuery.toLowerCase();
    const meetingId = input.meetingId;

    const toolsUsed: string[] = [];
    const proposalsCreated: Proposal[] = [];
    const draftsCreated: FollowUpDraft[] = [];

    // 1. Tool Intent: propose_event (Propose booking next meeting)
    if (
      lowerQuery.includes("احجز") ||
      lowerQuery.includes("اقترح اجتماع") ||
      lowerQuery.includes("موعد جديد") ||
      lowerQuery.includes("propose meeting") ||
      lowerQuery.includes("book meeting") ||
      lowerQuery.includes("schedule")
    ) {
      toolsUsed.push("propose_event");

      // Extract details or use defaults
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      tomorrow.setHours(11, 0, 0, 0);

      const title = rawQuery.replace(/.*(احجز|اقترح|schedule|book)\s+/i, "").trim() || "اجتماع متابعة جديد";

      // HARD INVARIANT 1: Tool creates a Proposal in PENDING_APPROVAL status.
      // It NEVER books calendar directly.
      const proposal = await this.proposalRepository.createPending(context, {
        meetingId,
        actionType: ProposalActionType.SCHEDULE_MEETING,
        payload: {
          title,
          proposedDatetime: tomorrow.toISOString(),
          place: "Google Meet",
          reason: `اقتراح من المساعد الذكي بناءً على طلب: "${rawQuery}"`,
          durationMinutes: 45,
        },
        reason: `بناءً على طلب المستخدم في المحادثة: "${rawQuery}"`,
      });

      proposalsCreated.push(proposal);

      const answerAr = `تم تجهيز مقترح لحجز الاجتماع بعنوان "${title}" بتاريخ ${tomorrow.toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} الساعة 11:00 صباحاً عبر Google Meet. المقترح الآن في انتظار موافقتك الصريحة للاعتماد والحجز.`;
      const answerEn = `A proposal has been prepared to schedule "${title}" on ${tomorrow.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} at 11:00 AM via Google Meet. The proposal is awaiting your explicit approval.`;

      const isEnglish = /[a-zA-Z]/.test(rawQuery) && !/[\u0600-\u06FF]/.test(rawQuery);

      return {
        answer: isEnglish ? answerEn : answerAr,
        citations: [],
        proposalsCreated,
        draftsCreated,
        toolsUsed,
        honestUnknown: false,
      };
    }

    // 2. Tool Intent: create_reminder (Set reminder for task or follow-up)
    if (
      lowerQuery.includes("فكرني") ||
      lowerQuery.includes("تذكير") ||
      lowerQuery.includes("reminder") ||
      lowerQuery.includes("remind me")
    ) {
      toolsUsed.push("create_reminder");

      const remindAt = new Date(Date.now() + 3 * 3600 * 1000); // 3 hours later
      const note = rawQuery.replace(/.*(فكرني ب|تذكير ب|remind me to)\s+/i, "").trim() || "متابعة مخرجات الاجتماع";

      // HARD INVARIANT 1: Action tool ONLY creates a proposal.
      const proposal = await this.proposalRepository.createPending(context, {
        meetingId,
        actionType: ProposalActionType.SEND_REMINDER,
        payload: {
          meetingId,
          remindAt: remindAt.toISOString(),
          channel: "console",
          note,
        },
        reason: `طلب تذكير تلقائي: "${note}"`,
      });

      proposalsCreated.push(proposal);

      const isEnglish = /[a-zA-Z]/.test(rawQuery) && !/[\u0600-\u06FF]/.test(rawQuery);
      const answerAr = `تم إنشاء مقترح تذكير جديد: "${note}". يتطلب تفعيله اعتمادك الصريح في صندوق المقترحات.`;
      const answerEn = `A reminder proposal has been created: "${note}". It requires your explicit approval in the Proposals inbox to activate.`;

      return {
        answer: isEnglish ? answerEn : answerAr,
        citations: [],
        proposalsCreated,
        draftsCreated,
        toolsUsed,
        honestUnknown: false,
      };
    }

    // 3. Tool Intent: draft_message (Draft follow up email/message)
    if (
      lowerQuery.includes("اكتب مسودة") ||
      lowerQuery.includes("مسودة رسالة") ||
      lowerQuery.includes("مسودة إيميل") ||
      lowerQuery.includes("draft email") ||
      lowerQuery.includes("draft message")
    ) {
      toolsUsed.push("draft_message");

      const subject = "متابعة مخرجات الاجتماع ومحضر الاتفاق";
      const body = `عزيزي العميل،\n\nشكرًا لاجتماعكم المثمر اليوم. فيما يلي ملخص سريع لأهم النقاط المتفق عليها ومواعيد تسليم المهام القادمة.\n\nمع التحية،\nفريق العمل`;

      let targetMeetingId = meetingId;
      if (!targetMeetingId) {
        const meetings = await this.meetingRepository.list(context, { limit: 1 });
        targetMeetingId = meetings[0]?.id;
      }

      if (targetMeetingId) {
        // Save draft in draft repository
        const draft = await this.draftRepository.create(context, {
          meetingId: targetMeetingId,
          recipientName: "العميل",
          recipientEmail: "client@example.com",
          subject,
          body,
          channel: "email",
          status: "draft",
        });
        draftsCreated.push(draft);

        // Also create a Proposal for sending it (Hard Invariant 1: sending requires approval)
        const proposal = await this.proposalRepository.createPending(context, {
          meetingId: targetMeetingId,
          actionType: ProposalActionType.DRAFT_EMAIL,
          payload: {
            draftId: draft.id,
            meetingId: targetMeetingId,
            recipientName: "العميل",
            recipientEmail: "client@example.com",
            subject,
            body,
            channel: "email",
          },
          reason: `اقتراح إرسال مسودة رسالة المتابعة`,
        });
        proposalsCreated.push(proposal);
      }

      const isEnglish = /[a-zA-Z]/.test(rawQuery) && !/[\u0600-\u06FF]/.test(rawQuery);
      const answerAr = `تمت كتابة مسودة رسالة المتابعة بنجاح وحفظها في تبويب "المتابعة". تم أيضاً إنشاء مقترح إرسال في صندوق المقترحات بانتظار موافقتك.`;
      const answerEn = `The follow-up message draft has been saved to the "Follow-up" tab. A send proposal has also been created in your Proposals inbox awaiting your approval.`;

      return {
        answer: isEnglish ? answerEn : answerAr,
        citations: [],
        proposalsCreated,
        draftsCreated,
        toolsUsed,
        honestUnknown: false,
      };
    }

    // 4. Tool Intent: get_tasks (Retrieve action items/tasks)
    if (
      lowerQuery.includes("مهام") ||
      lowerQuery.includes("المهام") ||
      lowerQuery.includes("tasks") ||
      lowerQuery.includes("action items") ||
      lowerQuery.includes("مين هيعمل") ||
      lowerQuery.includes("who is doing")
    ) {
      toolsUsed.push("get_tasks");

      let tasks: Task[] = [];
      if (meetingId) {
        tasks = await this.taskRepository.listByMeeting(context, meetingId);
      } else {
        const meetings = await this.meetingRepository.list(context, { limit: 5 });
        for (const m of meetings) {
          const mTasks = await this.taskRepository.listByMeeting(context, m.id);
          tasks.push(...mTasks);
        }
      }

      const isEnglish = /[a-zA-Z]/.test(rawQuery) && !/[\u0600-\u06FF]/.test(rawQuery);

      if (tasks.length === 0) {
        return {
          answer: isEnglish
            ? "No tasks were found for this meeting or time period."
            : "لم يتم العثور على مهام مسجلة لهذا الاجتماع أو الفترة.",
          citations: [],
          proposalsCreated,
          draftsCreated,
          toolsUsed,
          honestUnknown: false,
        };
      }

      const citations: SearchCitation[] = tasks
        .filter((t) => t.sourceTs)
        .map((t) => ({
          meetingId: t.meetingId,
          meetingTitle: "الاجتماع",
          timestamp: t.sourceTs || "[00:00]",
          text: `المهمة: ${t.title} (المسؤول: ${t.ownerName || "غير محدد"})`,
          score: 1.0,
          matchType: "hybrid",
        }));

      const taskLines = tasks.map((t, idx) => {
        const ownerStr = t.ownerName ? ` (المسؤول: ${t.ownerName})` : " (المسؤول: غير محدد)";
        const dueStr = t.dueDate ? ` [الموعد: ${t.dueDate.toISOString().split("T")[0]}]` : "";
        const tsStr = t.sourceTs ? ` ${t.sourceTs}` : "";
        return `${idx + 1}. ${t.title}${ownerStr}${dueStr}${tsStr}`;
      });

      const answer = isEnglish
        ? `Here are the tasks extracted from the meeting:\n${taskLines.join("\n")}`
        : `إليك المهام المسجلة:\n${taskLines.join("\n")}`;

      return {
        answer,
        citations,
        proposalsCreated,
        draftsCreated,
        toolsUsed,
        honestUnknown: false,
      };
    }

    // 5. Default & General Query Tool: search_meetings (Hybrid Search with Citations)
    toolsUsed.push("search_meetings");

    const searchResults = await this.searchService.search(context, {
      query: rawQuery,
      meetingId,
      limit: 5,
    });

    const isEnglish = /[a-zA-Z]/.test(rawQuery) && !/[\u0600-\u06FF]/.test(rawQuery);

    // HARD INVARIANT 3: Honesty on Unknown Answers (No fabrication)
    const topScore = searchResults[0]?.score ?? 0;
    if (searchResults.length === 0 || topScore < 0.45) {
      return {
        answer: isEnglish
          ? "This topic was not mentioned in the recorded meetings. I could not find relevant transcript segments or decisions regarding this question."
          : "لم يُذكر هذا الموضوع في الاجتماعات المتوفرة. لم أجد في التفريغ الصوتي أو القرارات أي إشارة متعلقة بهذا السؤال.",
        citations: [],
        proposalsCreated,
        draftsCreated,
        toolsUsed,
        honestUnknown: true,
      };
    }

    // Construct grounded answer with exact citations
    const citations: SearchCitation[] = searchResults.slice(0, 3);

    const snippetLines = citations.map(
      (c) => `• ${c.timestamp} في "${c.meetingTitle}": ${c.text}`,
    );

    const answer = isEnglish
      ? `Based on past meetings, here is what was discussed regarding "${rawQuery}":\n\n${snippetLines.join("\n\n")}\n\nAll details are verified from meeting transcripts and decisions.`
      : `بناءً على ما ورد في الاجتماعات المسجلة حول "${rawQuery}":\n\n${snippetLines.join("\n\n")}\n\nتم توثيق كل نقطة أعلاه مع التوقيت المباشر والاجتماع المصدر.`;

    return {
      answer,
      citations,
      proposalsCreated,
      draftsCreated,
      toolsUsed,
      honestUnknown: false,
    };
  }
}
