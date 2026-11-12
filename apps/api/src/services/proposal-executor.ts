import type { Proposal, TenantContext } from "@dawwen/db";
import {
  ProposalStatus,
  ProposalActionType,
  ReminderStatus,
  ProposalNotFoundError,
  ProposalAlreadyClaimedError,
  InvalidProposalTransitionError,
} from "@dawwen/db";
import type { Priority } from "@prisma/client";
import type {
  ProposalRepository,
  CalendarConnectionRepository,
  FollowUpDraftRepository,
  ReminderRepository,
  TaskRepository,
} from "@dawwen/db";
import type { CalendarProvider } from "./calendar.js";
import type { TokenEncryptor, GoogleOAuthTokens } from "@dawwen/shared";
import type { NotificationProvider } from "./notification.js";
import { ConsoleNotificationProvider } from "./notification.js";

export interface ExecutionResult {
  proposalId: string;
  actionType: ProposalActionType;
  status: ProposalStatus;
  executedAt: Date;
  details: Record<string, unknown>;
}

export class ProposalNotApprovedError extends Error {
  constructor(proposalId: string, status: string) {
    super(
      `Cannot execute proposal '${proposalId}': proposal must be approved by authenticated user first. Current status: ${status}`,
    );
    this.name = "ProposalNotApprovedError";
  }
}

export class ProposalExecutionFailedError extends Error {
  constructor(
    public readonly proposalId: string,
    public readonly reason: string,
  ) {
    super(`Proposal execution failed: ${reason}`);
    this.name = "ProposalExecutionFailedError";
  }
}

/** The proposal lacks data needed to act on it; nothing was approved or executed. */
export class ProposalIncompleteError extends Error {
  constructor(
    public readonly proposalId: string,
    public readonly missing: string[],
  ) {
    super(`Proposal '${proposalId}' is missing: ${missing.join(", ")}`);
    this.name = "ProposalIncompleteError";
  }
}

/** The channel needed to act (calendar, email) is not connected/configured. */
export class ProposalChannelUnavailableError extends Error {
  constructor(
    public readonly proposalId: string,
    public readonly channel: "calendar" | "email",
  ) {
    super(
      channel === "calendar"
        ? "Connect Google Calendar before approving a meeting booking."
        : "Email sending is not configured on this server.",
    );
    this.name = "ProposalChannelUnavailableError";
  }
}

export interface ProposalExecutorOptions {
  /**
   * Allow simulated channels (FakeCalendarProvider without a connection, console
   * email). Only for local dev/demo: production must never report a simulated
   * side effect as executed (ADR-023).
   */
  allowSimulated?: boolean;
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ProposalExecutor {
  private readonly notificationProvider: NotificationProvider;
  private readonly allowSimulated: boolean;

  constructor(
    private readonly proposalRepository: ProposalRepository,
    private readonly calendarConnectionRepository: CalendarConnectionRepository,
    private readonly calendarProvider: CalendarProvider,
    private readonly tokenEncryptor: TokenEncryptor,
    private readonly draftRepository?: FollowUpDraftRepository,
    private readonly reminderRepository?: ReminderRepository,
    private readonly taskRepository?: TaskRepository,
    notificationProvider?: NotificationProvider,
    options: ProposalExecutorOptions = {},
  ) {
    this.notificationProvider = notificationProvider ?? new ConsoleNotificationProvider();
    this.allowSimulated = options.allowSimulated ?? false;
  }

  /**
   * Refuses (before approving anything) a proposal that would need invented data:
   * no default dates, no placeholder recipients (Invariant 3 applied to actions).
   */
  private async assertExecutable(context: TenantContext, proposal: Proposal): Promise<void> {
    const payload = (proposal.payload ?? {}) as Record<string, unknown>;
    const missing: string[] = [];
    switch (proposal.actionType) {
      case ProposalActionType.SCHEDULE_MEETING: {
        if (!isValidDate(payload.proposedDatetime)) {
          missing.push("proposedDatetime");
          break;
        }
        const connection = await this.calendarConnectionRepository.getConnection(context, "google");
        if (
          !connection?.encryptedTokens &&
          !(this.allowSimulated && this.calendarProvider.simulated)
        ) {
          throw new ProposalChannelUnavailableError(proposal.id, "calendar");
        }
        break;
      }
      case ProposalActionType.DRAFT_EMAIL:
        if (typeof payload.recipientEmail !== "string" || !EMAIL_RE.test(payload.recipientEmail)) {
          missing.push("recipientEmail");
        }
        if (typeof payload.body !== "string" || !payload.body.trim()) missing.push("body");
        if (missing.length === 0 && this.notificationProvider.simulated && !this.allowSimulated) {
          throw new ProposalChannelUnavailableError(proposal.id, "email");
        }
        break;
      case ProposalActionType.SEND_REMINDER:
        if (!isValidDate(payload.remindAt) && typeof payload.reminderId !== "string") {
          missing.push("remindAt");
        }
        if (!this.reminderRepository) missing.push("reminderRepository");
        break;
      case ProposalActionType.CREATE_TASK:
        if (!proposal.meetingId && typeof payload.meetingId !== "string") missing.push("meetingId");
        if (!payload.title && !payload.task) missing.push("title");
        if (!this.taskRepository) missing.push("taskRepository");
        break;
      default:
        break;
    }
    if (missing.length > 0) throw new ProposalIncompleteError(proposal.id, missing);
  }

  /**
   * Hard Invariant 1: only executes a proposal the authenticated user approved.
   *
   * Exactly-once (ADR-022): the proposal is claimed with an atomic
   * APPROVED -> EXECUTING update BEFORE any side effect runs. Concurrent or
   * repeated approvals lose the claim and get ProposalAlreadyClaimedError, so a
   * meeting is never booked (or an email sent) twice.
   */
  async approveAndExecute(context: TenantContext, proposalId: string): Promise<ExecutionResult> {
    const existing = await this.proposalRepository.findById(context, proposalId);
    if (!existing) {
      throw new ProposalNotFoundError(proposalId);
    }

    if (
      existing.status !== ProposalStatus.PENDING_APPROVAL &&
      existing.status !== ProposalStatus.APPROVED
    ) {
      throw new ProposalNotApprovedError(proposalId, existing.status);
    }

    await this.assertExecutable(context, existing);

    if (existing.status === ProposalStatus.PENDING_APPROVAL) {
      try {
        await this.proposalRepository.approve(context, proposalId);
      } catch (err) {
        // Another request approved (or rejected) it first; the claim below decides.
        if (
          !(err instanceof ProposalAlreadyClaimedError) &&
          !(err instanceof InvalidProposalTransitionError)
        ) {
          throw err;
        }
      }
    }

    // Atomic claim — throws for every caller except one.
    const proposal = await this.proposalRepository.claimForExecution(context, proposalId);

    let executionDetails: Record<string, unknown>;
    try {
      switch (proposal.actionType) {
        case ProposalActionType.SCHEDULE_MEETING:
          executionDetails = await this.executeScheduleMeeting(context, proposal);
          break;
        case ProposalActionType.DRAFT_EMAIL:
          executionDetails = await this.executeDraftEmail(context, proposal);
          break;
        case ProposalActionType.SEND_REMINDER:
          executionDetails = await this.executeSendReminder(context, proposal);
          break;
        case ProposalActionType.CREATE_TASK:
          executionDetails = await this.executeCreateTask(context, proposal);
          break;
        default:
          throw new Error(`Unsupported proposal action '${String(proposal.actionType)}'.`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.proposalRepository.markFailed(context, proposalId, errMsg);
      throw new ProposalExecutionFailedError(proposalId, errMsg);
    }

    const executed = await this.proposalRepository.markExecuted(context, proposalId);

    return {
      proposalId,
      actionType: proposal.actionType,
      status: ProposalStatus.EXECUTED,
      executedAt: executed.executedAt ?? new Date(),
      details: executionDetails,
    };
  }

  async rejectProposal(
    context: TenantContext,
    proposalId: string,
    reason?: string,
  ): Promise<Proposal> {
    return this.proposalRepository.reject(context, proposalId, reason);
  }

  private async executeScheduleMeeting(
    context: TenantContext,
    proposal: Proposal,
  ): Promise<Record<string, unknown>> {
    const payload = proposal.payload as {
      proposedDatetime?: string;
      place?: string;
      title?: string;
      participants?: string[];
      durationMinutes?: number;
    };

    // Validated by assertExecutable: never invent a date.
    const start = new Date(payload.proposedDatetime!);
    const duration = payload.durationMinutes || 45;
    const end = new Date(start.getTime() + duration * 60000);
    const title = payload.title || "اجتماع متابعة (دوّن)";

    const connection = await this.calendarConnectionRepository.getConnection(context, "google");
    let tokens: GoogleOAuthTokens;
    if (connection?.encryptedTokens) {
      // A broken connection is a failure, not a silent fallback to a fake token.
      tokens = await this.tokenEncryptor.decrypt<GoogleOAuthTokens>(connection.encryptedTokens);
    } else if (this.allowSimulated && this.calendarProvider.simulated) {
      tokens = { accessToken: "simulated" };
    } else {
      throw new ProposalChannelUnavailableError(proposal.id, "calendar");
    }

    const created = await this.calendarProvider.createEvent(tokens, {
      title,
      start,
      end,
      description: `تم حجز هذا الاجتماع عبر منصة دوّن الذكية بموافقة صريحة من المستخدم.\nمرجع المقترح: ${proposal.id}`,
      location: payload.place || "Google Meet",
      attendees: payload.participants,
    });

    return {
      eventId: created.id,
      htmlLink: created.htmlLink,
      bookedTime: start.toISOString(),
      title,
      location: payload.place || "Google Meet",
    };
  }

  private async executeDraftEmail(
    context: TenantContext,
    proposal: Proposal,
  ): Promise<Record<string, unknown>> {
    const payload = proposal.payload as {
      meetingId?: string;
      recipientEmail?: string;
      recipientName?: string;
      channel?: string;
      subject?: string;
      body: string;
      draftId?: string;
    };

    // If draft already exists, update status to sent; otherwise create sent draft if draftRepository available
    let draftId = payload.draftId;
    if (this.draftRepository) {
      if (draftId) {
        await this.draftRepository.update(context, draftId, {
          status: "sent",
          sentAt: new Date(),
        });
      } else if (proposal.meetingId || payload.meetingId) {
        const mId = proposal.meetingId || payload.meetingId!;
        const draft = await this.draftRepository.create(context, {
          meetingId: mId,
          recipientEmail: payload.recipientEmail,
          recipientName: payload.recipientName,
          channel: payload.channel ?? "email",
          subject: payload.subject,
          body: payload.body,
          status: "sent",
        });
        draftId = draft.id;
      }
    }

    // Send via notification provider
    const sendResult = await this.notificationProvider.sendEmail({
      to: payload.recipientEmail!,
      subject: payload.subject || "متابعة الاجتماع",
      body: payload.body,
    });

    return {
      draftId,
      messageId: sendResult.messageId,
      channel: sendResult.channel,
      recipientEmail: payload.recipientEmail,
    };
  }

  private async executeSendReminder(
    context: TenantContext,
    proposal: Proposal,
  ): Promise<Record<string, unknown>> {
    const payload = proposal.payload as {
      taskId?: string;
      meetingId?: string;
      remindAt?: string;
      channel?: string;
      note?: string;
      reminderId?: string;
    };

    // Approving a reminder schedules it; the worker's dispatcher sends it when due
    // (ADR-020/023). Nothing is sent, or marked SENT, at approval time.
    const reminders = this.reminderRepository!;
    if (payload.reminderId) {
      const existing = await reminders.findById(context, payload.reminderId);
      if (!existing) throw new Error(`Reminder '${payload.reminderId}' not found.`);
      return {
        reminderId: existing.id,
        remindAt: existing.remindAt.toISOString(),
        scheduled: true,
      };
    }

    const remindAt = new Date(payload.remindAt!);
    const reminder = await reminders.create(context, {
      taskId: payload.taskId,
      meetingId: proposal.meetingId || payload.meetingId,
      remindAt,
      channel: payload.channel ?? "email",
      status: ReminderStatus.SCHEDULED,
    });
    return { reminderId: reminder.id, remindAt: remindAt.toISOString(), scheduled: true };
  }

  private async executeCreateTask(
    context: TenantContext,
    proposal: Proposal,
  ): Promise<Record<string, unknown>> {
    const payload = proposal.payload as {
      meetingId?: string;
      task?: string;
      title?: string;
      owner?: string | null;
      ownerName?: string | null;
      due?: string | null;
      dueDate?: string | null;
      priority?: string;
      sourceTs?: string | null;
    };

    const meetingId = proposal.meetingId || payload.meetingId;
    const title = payload.title || payload.task || "مهمة متابعة";
    const ownerName = payload.ownerName ?? payload.owner ?? null;
    const dueDate = payload.dueDate
      ? new Date(payload.dueDate)
      : payload.due
        ? new Date(payload.due)
        : null;

    // Validated by assertExecutable: a task is only reported when it really exists.
    const task = await this.taskRepository!.create(context, meetingId!, {
      title,
      ownerName,
      dueDate,
      priority: (payload.priority as Priority) ?? "MEDIUM",
      sourceTs: payload.sourceTs ?? null,
      needsReview: !ownerName || !dueDate,
    });

    return {
      taskId: task.id,
      title: task.title,
      ownerName: task.ownerName,
      dueDate: task.dueDate?.toISOString() ?? null,
    };
  }
}
