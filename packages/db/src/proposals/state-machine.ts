import { ProposalStatus, type Proposal } from "@prisma/client";

export class InvalidProposalTransitionError extends Error {
  constructor(
    public readonly currentStatus: ProposalStatus,
    public readonly targetStatus: ProposalStatus,
    message?: string,
  ) {
    super(
      message ??
        `Invalid proposal status transition from '${currentStatus}' to '${targetStatus}'. Invariant: Actions require authenticated approval before execution.`,
    );
    this.name = "InvalidProposalTransitionError";
  }
}

export class UnauthorizedProposalExecutionError extends Error {
  constructor(message = "Unauthorized: Side effects may never execute directly from PENDING_APPROVAL.") {
    super(message);
    this.name = "UnauthorizedProposalExecutionError";
  }
}

/**
 * Valid transitions:
 * PENDING_APPROVAL -> APPROVED (only by authenticated user)
 * PENDING_APPROVAL -> REJECTED (only by authenticated user)
 * APPROVED -> EXECUTED (only after approval has occurred)
 * APPROVED -> FAILED (if external executor encounters error)
 */
export function canTransitionProposal(
  from: ProposalStatus,
  to: ProposalStatus,
): boolean {
  if (from === ProposalStatus.PENDING_APPROVAL) {
    return to === ProposalStatus.APPROVED || to === ProposalStatus.REJECTED;
  }
  if (from === ProposalStatus.APPROVED) {
    return to === ProposalStatus.EXECUTED || to === ProposalStatus.FAILED;
  }
  return false;
}

export function validateProposalTransition(
  from: ProposalStatus,
  to: ProposalStatus,
): void {
  // Hard Invariant 1: Direct transition from PENDING_APPROVAL to EXECUTED is strictly forbidden
  if (from === ProposalStatus.PENDING_APPROVAL && to === ProposalStatus.EXECUTED) {
    throw new UnauthorizedProposalExecutionError();
  }

  if (!canTransitionProposal(from, to)) {
    throw new InvalidProposalTransitionError(from, to);
  }
}

export interface ProposalTransitionResult {
  previousStatus: ProposalStatus;
  newStatus: ProposalStatus;
  executedAt?: Date;
  error?: string;
}

export function transitionProposal(
  proposal: Pick<Proposal, "id" | "status">,
  targetStatus: ProposalStatus,
  options?: { error?: string },
): ProposalTransitionResult {
  validateProposalTransition(proposal.status, targetStatus);

  return {
    previousStatus: proposal.status,
    newStatus: targetStatus,
    executedAt: targetStatus === ProposalStatus.EXECUTED ? new Date() : undefined,
    error: options?.error,
  };
}
