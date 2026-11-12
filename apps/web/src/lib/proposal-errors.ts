import { ApiError } from "./http";

const KNOWN = new Set([
  "proposal_incomplete",
  "calendar_not_connected",
  "email_not_configured",
  "conflict",
  "execution_failed",
]);

/** i18n key explaining why approving a proposal was refused (ADR-023). */
export function proposalErrorKey(err: unknown): string {
  if (err instanceof ApiError && err.code && KNOWN.has(err.code)) {
    return `proposals.errors.${err.code}`;
  }
  return "errors.generic";
}
