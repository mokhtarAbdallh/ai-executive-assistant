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
  validateProposalTransition,
  transitionProposal,
} from "../proposals/state-machine.js";

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

  async approve(context: TenantContext, proposalId: string): Promise<Proposal> {
    const proposal = await this.findById(context, proposalId);
    if (!proposal) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }

    validateProposalTransition(proposal.status, ProposalStatus.APPROVED);

    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status: ProposalStatus.APPROVED },
    });
  }

  async reject(
    context: TenantContext,
    proposalId: string,
    reason?: string,
  ): Promise<Proposal> {
    const proposal = await this.findById(context, proposalId);
    if (!proposal) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }

    validateProposalTransition(proposal.status, ProposalStatus.REJECTED);

    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: {
        status: ProposalStatus.REJECTED,
        reason: reason ?? proposal.reason,
      },
    });
  }

  async markExecuted(
    context: TenantContext,
    proposalId: string,
  ): Promise<Proposal> {
    const proposal = await this.findById(context, proposalId);
    if (!proposal) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }

    const transition = transitionProposal(proposal, ProposalStatus.EXECUTED);

    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: {
        status: transition.newStatus,
        executedAt: transition.executedAt,
      },
    });
  }

  async markFailed(
    context: TenantContext,
    proposalId: string,
    errorMessage: string,
  ): Promise<Proposal> {
    const proposal = await this.findById(context, proposalId);
    if (!proposal) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }

    const transition = transitionProposal(proposal, ProposalStatus.FAILED, {
      error: errorMessage,
    });

    return this.prisma.proposal.update({
      where: { id: proposalId },
      data: {
        status: transition.newStatus,
        error: transition.error,
      },
    });
  }
}
