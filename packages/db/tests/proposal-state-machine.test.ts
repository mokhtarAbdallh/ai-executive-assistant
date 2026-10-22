import { describe, it, expect } from "vitest";
import { ProposalStatus } from "@prisma/client";
import {
  canTransitionProposal,
  validateProposalTransition,
  transitionProposal,
  UnauthorizedProposalExecutionError,
  InvalidProposalTransitionError,
} from "../src/proposals/state-machine.js";

describe("Proposal State Machine (Hard Invariant 1: Human-in-the-loop)", () => {
  it("allows transition from PENDING_APPROVAL to APPROVED or REJECTED", () => {
    expect(canTransitionProposal(ProposalStatus.PENDING_APPROVAL, ProposalStatus.APPROVED)).toBe(true);
    expect(canTransitionProposal(ProposalStatus.PENDING_APPROVAL, ProposalStatus.REJECTED)).toBe(true);
  });

  it("strictly forbids executing a proposal directly from PENDING_APPROVAL", () => {
    expect(() =>
      validateProposalTransition(ProposalStatus.PENDING_APPROVAL, ProposalStatus.EXECUTED),
    ).toThrow(UnauthorizedProposalExecutionError);
  });

  it("allows transition from APPROVED to EXECUTED or FAILED", () => {
    expect(canTransitionProposal(ProposalStatus.APPROVED, ProposalStatus.EXECUTED)).toBe(true);
    expect(canTransitionProposal(ProposalStatus.APPROVED, ProposalStatus.FAILED)).toBe(true);
  });

  it("forbids any transition out of REJECTED or EXECUTED", () => {
    expect(canTransitionProposal(ProposalStatus.REJECTED, ProposalStatus.APPROVED)).toBe(false);
    expect(canTransitionProposal(ProposalStatus.REJECTED, ProposalStatus.EXECUTED)).toBe(false);
    expect(canTransitionProposal(ProposalStatus.EXECUTED, ProposalStatus.APPROVED)).toBe(false);
    expect(canTransitionProposal(ProposalStatus.EXECUTED, ProposalStatus.PENDING_APPROVAL)).toBe(false);

    expect(() =>
      validateProposalTransition(ProposalStatus.REJECTED, ProposalStatus.APPROVED),
    ).toThrow(InvalidProposalTransitionError);
  });

  it("transitionProposal stamps executedAt on successful execution", () => {
    const proposal = { id: "prop-123", status: ProposalStatus.APPROVED };
    const result = transitionProposal(proposal, ProposalStatus.EXECUTED);

    expect(result.previousStatus).toBe(ProposalStatus.APPROVED);
    expect(result.newStatus).toBe(ProposalStatus.EXECUTED);
    expect(result.executedAt).toBeInstanceOf(Date);
  });

  it("transitionProposal captures error message on failure", () => {
    const proposal = { id: "prop-456", status: ProposalStatus.APPROVED };
    const result = transitionProposal(proposal, ProposalStatus.FAILED, {
      error: "Google Calendar API rate limit exceeded",
    });

    expect(result.previousStatus).toBe(ProposalStatus.APPROVED);
    expect(result.newStatus).toBe(ProposalStatus.FAILED);
    expect(result.error).toBe("Google Calendar API rate limit exceeded");
  });
});
