import { z } from "zod";

/** Kinds of side effects. Every one of them must go through an approved Proposal (Invariant 1). */
export const PROPOSAL_TYPES = [
  "calendar_event",
  "reminder",
  "send_message",
  "delete_data",
] as const;
export const ProposalTypeSchema = z.enum(PROPOSAL_TYPES);
export type ProposalType = z.infer<typeof ProposalTypeSchema>;

export const PROPOSAL_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "executed",
  "failed",
] as const;
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

/** Who created the proposal. AI/agent code may only ever create proposals. */
export const ProposalOriginSchema = z.enum(["analysis", "agent", "user"]);
export type ProposalOrigin = z.infer<typeof ProposalOriginSchema>;
