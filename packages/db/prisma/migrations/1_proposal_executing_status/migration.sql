-- ADR-022: proposals are claimed atomically (APPROVED -> EXECUTING) before any side
-- effect runs, so concurrent approvals can never execute the same proposal twice.
ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'EXECUTING' AFTER 'APPROVED';
