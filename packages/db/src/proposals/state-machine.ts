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
 * Thrown when a proposal could not be claimed for execution because another
 * request already claimed (or finished) it. Maps to HTTP 409.
 */
export class ProposalAlreadyClaimedError extends Error {
  constructor(public readonly proposalId: string) {
    super(`Proposal '${proposalId}' is already being executed or is no longer approvable.`);
    this.name = "ProposalAlreadyClaimedError";
  }
}

/**
 * Valid transitions (ADR-004, ADR-022):
 * PENDING_APPROVAL -> APPROVED  (only by authenticated user)
 * PENDING_APPROVAL -> REJECTED  (only by authenticated user)
 * APPROVED         -> EXECUTING (atomic claim by exactly one executor)
 * APPROVED         -> REJECTED  (user changes their mind before execution)
 * EXECUTING        -> EXECUTED  (side effect succeeded)
 * EXECUTING        -> FAILED    (side effect failed)
 */
const TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  [ProposalStatus.PENDING_APPROVAL]: [ProposalStatus.APPROVED, ProposalStatus.REJECTED],
  [ProposalStatus.APPROVED]: [ProposalStatus.EXECUTING, ProposalStatus.REJECTED],
  [ProposalStatus.EXECUTING]: [ProposalStatus.EXECUTED, ProposalStatus.FAILED],
  [ProposalStatus.EXECUTED]: [],
  [ProposalStatus.REJECTED]: [],
  [ProposalStatus.FAILED]: [],
};

export function canTransitionProposal(from: ProposalStatus, to: ProposalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses from which a transition to `to` is allowed (used for atomic conditional updates). */
export function allowedSourceStatuses(to: ProposalStatus): ProposalStatus[] {
  return (Object.keys(TRANSITIONS) as ProposalStatus[]).filter((from) =>
    TRANSITIONS[from].includes(to),
  );
}

export function validateProposalTransition(from: ProposalStatus, to: ProposalStatus): void {
  // Hard Invariant 1: a side effect may never start without an approval.
  if (
    from === ProposalStatus.PENDING_APPROVAL &&
    (to === ProposalStatus.EXECUTING || to === ProposalStatus.EXECUTED)
  ) {
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
