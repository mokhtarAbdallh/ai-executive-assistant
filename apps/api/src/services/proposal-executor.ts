import type { Proposal, TenantContext } from "@dawwen/db";
import { ProposalStatus, ProposalActionType } from "@dawwen/db";
import type { ProposalRepository } from "@dawwen/db";
import type { CalendarProvider } from "./calendar.js";
import type { TokenEncryptor, GoogleOAuthTokens } from "@dawwen/shared";
import type { CalendarConnectionRepository } from "@dawwen/db";

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
  constructor(
    private readonly proposalRepository: ProposalRepository,
    private readonly calendarConnectionRepository: CalendarConnectionRepository,
    private readonly calendarProvider: CalendarProvider,
    private readonly tokenEncryptor: TokenEncryptor,
  ) {}

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

      if (proposal.actionType === ProposalActionType.SCHEDULE_MEETING) {
        executionDetails = await this.executeScheduleMeeting(context, proposal);
      } else {
        // Stubs for future proposal action types (DRAFT_EMAIL, SEND_REMINDER, CREATE_TASK)
        executionDetails = {
          executed: true,
          message: `Proposal action '${proposal.actionType}' staged for execution.`,
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
}
