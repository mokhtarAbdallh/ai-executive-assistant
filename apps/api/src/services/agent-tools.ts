import { z } from "zod";
import type {
  FollowUpDraft,
  FollowUpDraftRepository,
  MeetingRepository,
  Proposal,
  ProposalRepository,
  Task,
  TaskRepository,
  TenantContext,
} from "@dawwen/db";
import { CrossTenantAccessViolationError, ProposalActionType } from "@dawwen/db";
import type { AgentToolSpec } from "@dawwen/llm";
import type { SearchCitation, SearchService } from "./search.js";
import { formatInZone, zonedTimeToUtc } from "./timezone.js";

/** Search hits below this score are noise, not evidence (Invariant 3). */
export const MIN_CITATION_SCORE = 0.45;

/**
 * Tools of the Ask assistant (ADR-024). Read tools return data from the user's
 * own meetings; action tools ONLY create a draft and/or a PENDING_APPROVAL
 * proposal (Invariant 1) and never invent a date or a recipient (Invariant 3).
 */
export const AGENT_TOOLS: AgentToolSpec[] = [
  {
    name: "search_meetings",
    description:
      "Search the user's meeting transcripts and decisions. Returns passages with the meeting title and a [MM:SS] timestamp. Use it for any question about what was said or decided.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords in the language of the meeting." },
        meetingId: { type: "string", description: "Limit to one meeting (optional)." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_tasks",
    description:
      "List action items with owner, due date (user's time zone) and source timestamp. Without meetingId it covers the 5 most recent meetings.",
    inputSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        status: { type: "string", enum: ["open", "done", "all"] },
      },
    },
  },
  {
    name: "draft_message",
    description:
      "Save a follow-up message draft and create a proposal to send it. Nothing is sent until the user approves. Only pass recipientEmail if the user or a meeting gave it; never guess one.",
    inputSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        recipientName: { type: "string" },
        recipientEmail: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: "create_reminder",
    description:
      "Propose a reminder for the user. Creates a proposal only; it is scheduled after approval. date/time are in the user's time zone; leave them out if the user gave no time.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD in the user's time zone" },
        time: { type: "string", description: "HH:mm (24h) in the user's time zone" },
        meetingId: { type: "string" },
      },
      required: ["note"],
    },
  },
  {
    name: "propose_event",
    description:
      "Propose a calendar event. Creates a proposal only; the user must approve before anything is booked. date/time are wall-clock values in the user's time zone. Leave them out if the user did not give a day and time; never pick one yourself.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD in the user's time zone" },
        time: { type: "string", description: "HH:mm (24h) in the user's time zone" },
        durationMinutes: { type: "integer", minimum: 15, maximum: 480 },
        participants: { type: "array", items: { type: "string" }, description: "Emails" },
        meetingId: { type: "string", description: "The meeting this follows up on" },
      },
      required: ["title"],
    },
  },
];

const SearchInput = z.object({
  query: z.string().trim().min(1).max(300),
  meetingId: z.string().max(64).optional(),
});
const TasksInput = z.object({
  meetingId: z.string().max(64).optional(),
  status: z.enum(["open", "done", "all"]).default("all"),
});
const DraftInput = z.object({
  meetingId: z.string().max(64).optional(),
  recipientName: z.string().trim().max(200).optional(),
  recipientEmail: z.string().trim().email().optional(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10_000),
});
const EventInput = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.string().optional(),
  time: z.string().optional(),
  durationMinutes: z.number().int().min(15).max(480).default(30),
  participants: z.array(z.string().trim().email()).max(50).optional(),
  meetingId: z.string().max(64).optional(),
});

const ReminderInput = z.object({
  note: z.string().trim().min(1).max(500),
  date: z.string().optional(),
  time: z.string().optional(),
  meetingId: z.string().max(64).optional(),
});

/** A tool failure the model can read and recover from (shown as an error result). */
export class ToolInputError extends Error {}

export interface ToolRunState {
  citations: SearchCitation[];
  proposals: Proposal[];
  drafts: FollowUpDraft[];
  /** True when a search ran and found nothing usable. */
  searchedWithoutEvidence: boolean;
}

export interface AgentToolDeps {
  searchService: SearchService;
  taskRepository: TaskRepository;
  proposalRepository: ProposalRepository;
  draftRepository: FollowUpDraftRepository;
  meetingRepository: MeetingRepository;
}

export interface ToolContext {
  tenant: TenantContext;
  timeZone: string;
  language: "ar" | "en";
  /** Meeting the chat is opened on, if any. */
  currentMeetingId?: string;
  now: Date;
}

export async function runAgentTool(
  name: string,
  rawInput: unknown,
  deps: AgentToolDeps,
  ctx: ToolContext,
  state: ToolRunState,
): Promise<unknown> {
  try {
    switch (name) {
      case "search_meetings":
        return await searchMeetings(SearchInput.parse(rawInput), deps, ctx, state);
      case "get_tasks":
        return await getTasks(TasksInput.parse(rawInput), deps, ctx, state);
      case "draft_message":
        return await draftMessage(DraftInput.parse(rawInput), deps, ctx, state);
      case "create_reminder":
        return await createReminder(ReminderInput.parse(rawInput), deps, ctx, state);
      case "propose_event":
        return await proposeEvent(EventInput.parse(rawInput), deps, ctx, state);
      default:
        throw new ToolInputError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ToolInputError(`Invalid input: ${err.issues.map((i) => i.message).join("; ")}`);
    }
    if (err instanceof CrossTenantAccessViolationError) {
      throw new ToolInputError("Meeting not found");
    }
    throw err;
  }
}

async function ownedMeetingId(
  deps: AgentToolDeps,
  ctx: ToolContext,
  meetingId: string | undefined,
): Promise<string | undefined> {
  const id = meetingId ?? ctx.currentMeetingId;
  if (!id) return undefined;
  // Throws CrossTenantAccessViolationError for another user's meeting.
  const meeting = await deps.meetingRepository.findById(ctx.tenant, id);
  if (!meeting) throw new ToolInputError("Meeting not found");
  return meeting.id;
}

async function searchMeetings(
  input: z.infer<typeof SearchInput>,
  deps: AgentToolDeps,
  ctx: ToolContext,
  state: ToolRunState,
) {
  const results = (
    await deps.searchService.search(ctx.tenant, {
      query: input.query,
      meetingId: input.meetingId ?? ctx.currentMeetingId,
      limit: 5,
    })
  ).filter((r) => r.score >= MIN_CITATION_SCORE);

  if (results.length === 0) {
    state.searchedWithoutEvidence = state.citations.length === 0;
    return { results: [], note: "Nothing relevant was found in the user's meetings." };
  }
  state.searchedWithoutEvidence = false;
  for (const r of results) {
    if (!state.citations.some((c) => c.meetingId === r.meetingId && c.timestamp === r.timestamp)) {
      state.citations.push(r);
    }
  }
  return {
    results: results.map((r) => ({
      meetingTitle: r.meetingTitle,
      meetingId: r.meetingId,
      timestamp: r.timestamp,
      speaker: r.speakerLabel ?? undefined,
      text: r.text,
    })),
  };
}

function matchesStatus(task: Task, status: "open" | "done" | "all"): boolean {
  if (status === "all") return true;
  const done = task.status === "COMPLETED" || task.status === "CANCELLED";
  return status === "done" ? done : !done;
}

async function getTasks(
  input: z.infer<typeof TasksInput>,
  deps: AgentToolDeps,
  ctx: ToolContext,
  state: ToolRunState,
) {
  const meetingId = input.meetingId ?? ctx.currentMeetingId;
  const meetings = meetingId
    ? [{ id: meetingId, title: undefined as string | undefined }]
    : (await deps.meetingRepository.list(ctx.tenant, { limit: 5 })).map((m) => ({
        id: m.id,
        title: m.title as string | undefined,
      }));

  const tasks: Array<Task & { meetingTitle?: string }> = [];
  for (const m of meetings) {
    const list = await deps.taskRepository.listByMeeting(ctx.tenant, m.id);
    tasks.push(...list.map((t) => ({ ...t, meetingTitle: m.title })));
  }
  const selected = tasks.filter((t) => matchesStatus(t, input.status)).slice(0, 30);

  for (const t of selected) {
    if (t.sourceTs) {
      state.citations.push({
        meetingId: t.meetingId,
        meetingTitle: t.meetingTitle ?? "",
        timestamp: t.sourceTs,
        text: t.title,
        score: 1,
        matchType: "hybrid",
      });
    }
  }

  return {
    tasks: selected.map((t) => ({
      title: t.title,
      owner: t.ownerName ?? null,
      due: t.dueDate ? formatInZone(t.dueDate, ctx.timeZone, ctx.language) : null,
      status: t.status,
      needsReview: t.needsReview,
      sourceTimestamp: t.sourceTs ?? null,
      meetingTitle: t.meetingTitle,
    })),
  };
}

async function draftMessage(
  input: z.infer<typeof DraftInput>,
  deps: AgentToolDeps,
  ctx: ToolContext,
  state: ToolRunState,
) {
  const meetingId = await ownedMeetingId(deps, ctx, input.meetingId);
  if (!meetingId) {
    throw new ToolInputError("A draft belongs to a meeting: ask the user which meeting.");
  }
  const recipientEmail = input.recipientEmail ?? null;

  const draft = await deps.draftRepository.create(ctx.tenant, {
    meetingId,
    recipientName: input.recipientName ?? null,
    recipientEmail,
    subject: input.subject,
    body: input.body,
    channel: "email",
    status: "draft",
  });
  state.drafts.push(draft);

  // Invariant 1: sending is a proposal the user must approve.
  const proposal = await deps.proposalRepository.createPending(ctx.tenant, {
    meetingId,
    actionType: ProposalActionType.DRAFT_EMAIL,
    payload: {
      draftId: draft.id,
      meetingId,
      recipientName: input.recipientName ?? null,
      recipientEmail,
      subject: input.subject,
      body: input.body,
      channel: "email",
      needsReview: recipientEmail === null,
    },
    reason: "Drafted by the assistant at the user's request",
  });
  state.proposals.push(proposal);

  return {
    draftSaved: true,
    proposalId: proposal.id,
    status: "PENDING_APPROVAL",
    missing: recipientEmail ? [] : ["recipientEmail"],
  };
}

/** Wall-clock date+time in the user's zone → UTC; both or neither; must be in the future. */
function resolveWhen(
  date: string | undefined,
  time: string | undefined,
  ctx: ToolContext,
): Date | null {
  if (!date && !time) return null;
  if (!date || !time) {
    throw new ToolInputError("Give both date (YYYY-MM-DD) and time (HH:mm), or neither.");
  }
  const instant = zonedTimeToUtc(date, time, ctx.timeZone);
  if (!instant) throw new ToolInputError("Invalid date or time format.");
  if (instant.getTime() <= ctx.now.getTime()) {
    throw new ToolInputError("That time is in the past; ask the user for a future time.");
  }
  return instant;
}

async function createReminder(
  input: z.infer<typeof ReminderInput>,
  deps: AgentToolDeps,
  ctx: ToolContext,
  state: ToolRunState,
) {
  const meetingId = await ownedMeetingId(deps, ctx, input.meetingId);
  const remindAt = resolveWhen(input.date, input.time, ctx);

  const proposal = await deps.proposalRepository.createPending(ctx.tenant, {
    meetingId,
    actionType: ProposalActionType.SEND_REMINDER,
    payload: {
      meetingId: meetingId ?? null,
      note: input.note,
      remindAt: remindAt ? remindAt.toISOString() : null,
      timezone: ctx.timeZone,
      needsReview: remindAt === null,
    },
    reason: "Reminder proposed by the assistant at the user's request",
  });
  state.proposals.push(proposal);

  return {
    proposalId: proposal.id,
    status: "PENDING_APPROVAL",
    when: remindAt ? formatInZone(remindAt, ctx.timeZone, ctx.language) : null,
    missing: remindAt ? [] : ["date", "time"],
  };
}

async function proposeEvent(
  input: z.infer<typeof EventInput>,
  deps: AgentToolDeps,
  ctx: ToolContext,
  state: ToolRunState,
) {
  const meetingId = await ownedMeetingId(deps, ctx, input.meetingId);

  const start = resolveWhen(input.date, input.time, ctx);

  const proposal = await deps.proposalRepository.createPending(ctx.tenant, {
    meetingId,
    actionType: ProposalActionType.SCHEDULE_MEETING,
    payload: {
      title: input.title,
      proposedDatetime: start ? start.toISOString() : null,
      durationMinutes: input.durationMinutes,
      participants: input.participants ?? [],
      timezone: ctx.timeZone,
      needsReview: start === null,
    },
    reason: "Proposed by the assistant at the user's request",
  });
  state.proposals.push(proposal);

  return {
    proposalId: proposal.id,
    status: "PENDING_APPROVAL",
    when: start ? formatInZone(start, ctx.timeZone, ctx.language) : null,
    missing: start ? [] : ["date", "time"],
  };
}
