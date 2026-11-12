import type {
  PrismaClient,
  Proposal,
  ProposalActionType,
  Prisma} from "@prisma/client";
import {
  ProposalStatus
} from "@prisma/client";
import type { TenantContext} from "./base.js";
import { CrossTenantAccessViolationError } from "./base.js";
import {
  allowedSourceStatuses,
  validateProposalTransition,
  ProposalAlreadyClaimedError,
} from "../proposals/state-machine.js";

export class ProposalNotFoundError extends Error {
  constructor(public readonly proposalId: string) {
    super(`Proposal '${proposalId}' not found.`);
    this.name = "ProposalNotFoundError";
  }
}

export class ProposalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPending(
    context: TenantContext,
    data: {
      meetingId?: string;
      actionType: ProposalActionType;
      payload: Prisma.InputJsonValue;
      reason?: string;
    },
  ): Promise<Proposal> {
    return this.prisma.proposal.create({
      data: {
        userId: context.userId,
        meetingId: data.meetingId,
        actionType: data.actionType,
        payload: data.payload,
        status: ProposalStatus.PENDING_APPROVAL,
        reason: data.reason,
      },
    });
  }

  async findById(context: TenantContext, proposalId: string): Promise<Proposal | null> {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) {
      return null;
    }

    if (proposal.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(proposalId, context.userId, "Proposal");
    }

    return proposal;
  }

  async list(
    context: TenantContext,
    filter?: { status?: ProposalStatus; limit?: number },
  ): Promise<Proposal[]> {
    return this.prisma.proposal.findMany({
      where: {
        userId: context.userId,
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: filter?.limit ?? 50,
    });
  }

  /**
   * Moves a proposal to `to` with ONE conditional UPDATE (status must be one of the
   * allowed source statuses). Two concurrent requests can never both succeed, which
   * is what keeps side effects from running twice (ADR-022).
   */
  private async transitionAtomically(
    context: TenantContext,
    proposalId: string,
    to: ProposalStatus,
    data: Prisma.ProposalUpdateManyMutationInput = {},
  ): Promise<Proposal> {
    const result = await this.prisma.proposal.updateMany({
      where: {
        id: proposalId,
        userId: context.userId,
        status: { in: allowedSourceStatuses(to) },
      },
      data: { ...data, status: to },
    });

    if (result.count === 1) {
      const updated = await this.findById(context, proposalId);
      if (!updated) throw new Error(`Proposal '${proposalId}' not found.`);
      return updated;
    }

    // Nothing updated: explain why (missing, other tenant, invalid transition, or lost a race).
    const current = await this.findById(context, proposalId);
    if (!current) {
      throw new ProposalNotFoundError(proposalId);
    }
    const alreadyClaimed: ProposalStatus[] = [
      ProposalStatus.EXECUTING,
      ProposalStatus.EXECUTED,
      ProposalStatus.FAILED,
    ];
    if (to === ProposalStatus.EXECUTING && alreadyClaimed.includes(current.status)) {
      throw new ProposalAlreadyClaimedError(proposalId);
    }
    validateProposalTransition(current.status, to);
    throw new ProposalAlreadyClaimedError(proposalId);
  }

  async approve(context: TenantContext, proposalId: string): Promise<Proposal> {
    return this.transitionAtomically(context, proposalId, ProposalStatus.APPROVED);
  }

  async reject(
    context: TenantContext,
    proposalId: string,
    reason?: string,
  ): Promise<Proposal> {
    return this.transitionAtomically(
      context,
      proposalId,
      ProposalStatus.REJECTED,
      reason !== undefined ? { reason } : {},
    );
  }

  /**
   * Atomically claims an APPROVED proposal for execution (APPROVED -> EXECUTING).
   * Exactly one caller wins; the others get ProposalAlreadyClaimedError.
   */
  async claimForExecution(context: TenantContext, proposalId: string): Promise<Proposal> {
    return this.transitionAtomically(context, proposalId, ProposalStatus.EXECUTING);
  }

  async markExecuted(context: TenantContext, proposalId: string): Promise<Proposal> {
    return this.transitionAtomically(context, proposalId, ProposalStatus.EXECUTED, {
      executedAt: new Date(),
      error: null,
    });
  }

  async markFailed(
    context: TenantContext,
    proposalId: string,
    errorMessage: string,
  ): Promise<Proposal> {
    return this.transitionAtomically(context, proposalId, ProposalStatus.FAILED, {
      error: errorMessage,
    });
  }
}
