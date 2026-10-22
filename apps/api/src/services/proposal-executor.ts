import type { Proposal, TenantContext } from "@dawwen/db";
import { ProposalStatus, ProposalActionType, ReminderStatus } from "@dawwen/db";
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
    super(`Cannot execute proposal '${proposalId}': proposal must be approved by authenticated user first. Current status: ${status}`);
    this.name = "ProposalNotApprovedError";
  }
}

export class ProposalExecutor {
  private readonly notificationProvider: NotificationProvider;

  constructor(
    private readonly proposalRepository: ProposalRepository,
    private readonly calendarConnectionRepository: CalendarConnectionRepository,
    private readonly calendarProvider: CalendarProvider,
    private readonly tokenEncryptor: TokenEncryptor,
    private readonly draftRepository?: FollowUpDraftRepository,
    private readonly reminderRepository?: ReminderRepository,
    private readonly taskRepository?: TaskRepository,
    notificationProvider?: NotificationProvider,
  ) {
    this.notificationProvider = notificationProvider ?? new ConsoleNotificationProvider();
  }

  /**
   * Hard Invariant 1:
   * Only executes if authenticated user has approved the proposal.
   */
  async approveAndExecute(
    context: TenantContext,
    proposalId: string,
  ): Promise<ExecutionResult> {
    const proposal = await this.proposalRepository.findById(context, proposalId);
    if (!proposal) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }

    // Must be in PENDING_APPROVAL or already APPROVED
    if (
      proposal.status !== ProposalStatus.PENDING_APPROVAL &&
      proposal.status !== ProposalStatus.APPROVED
    ) {
      throw new ProposalNotApprovedError(proposalId, proposal.status);
    }

    // Transition to APPROVED first if still PENDING_APPROVAL
    if (proposal.status === ProposalStatus.PENDING_APPROVAL) {
      await this.proposalRepository.approve(context, proposalId);
    }

    // Now execute based on actionType
    try {
      let executionDetails: Record<string, unknown> = {};

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
          executionDetails = {
            executed: true,
            message: `Proposal action '${proposal.actionType}' handled.`,
          };
      }

      await this.proposalRepository.markExecuted(context, proposalId);

      return {
        proposalId,
        actionType: proposal.actionType,
        status: ProposalStatus.EXECUTED,
        executedAt: new Date(),
        details: executionDetails,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.proposalRepository.markFailed(context, proposalId, errMsg);
      throw new Error(`Proposal execution failed: ${errMsg}`);
    }
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

    const start = payload.proposedDatetime ? new Date(payload.proposedDatetime) : new Date(Date.now() + 86400000);
    const duration = payload.durationMinutes || 45;
    const end = new Date(start.getTime() + duration * 60000);
    const title = payload.title || "اجتماع متابعة (دوّن)";

    // Look for calendar connection
    const connection = await this.calendarConnectionRepository.getConnection(context, "google");

    let tokens: GoogleOAuthTokens = { accessToken: "demo-token" };
    if (connection?.encryptedTokens) {
      try {
        tokens = await this.tokenEncryptor.decrypt<GoogleOAuthTokens>(connection.encryptedTokens);
      } catch {
        tokens = { accessToken: "demo-token" };
      }
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
      to: payload.recipientEmail || "client@example.com",
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

    const remindAt = payload.remindAt ? new Date(payload.remindAt) : new Date(Date.now() + 3600000);
    let reminderId = payload.reminderId;

    if (this.reminderRepository) {
      if (reminderId) {
        await this.reminderRepository.updateStatus(context, reminderId, ReminderStatus.SENT, new Date());
      } else {
        const reminder = await this.reminderRepository.create(context, {
          taskId: payload.taskId,
          meetingId: proposal.meetingId || payload.meetingId,
          remindAt,
          channel: payload.channel ?? "console",
          status: ReminderStatus.SCHEDULED,
        });
        reminderId = reminder.id;
      }
    }

    const notifResult = await this.notificationProvider.sendReminder({
      recipientId: context.userId,
      channel: payload.channel ?? "console",
      remindAt,
      note: payload.note || "تذكير بمهمة من اجتماع دوّن",
    });

    return {
      reminderId,
      messageId: notifResult.messageId,
      remindAt: remindAt.toISOString(),
    };
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

    if (!this.taskRepository || !meetingId) {
      return { created: true, title };
    }

    const task = await this.taskRepository.create(context, meetingId, {
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
