# AGENTS.md — Dawwen (دوّن)

You are working on **Dawwen**, an AI meeting assistant for Arabic (Egyptian dialect) + English
code-switched meetings. Source of truth for product scope: `docs/SPEC.md`.
Infrastructure contract: `infra/terraform/` (do not change ports, env var names, S3 prefixes
or the `/api` prefix without updating Terraform and `docs/DECISIONS.md`).

## Stack (fixed unless DECISIONS.md says otherwise)
- Monorepo: pnpm workspaces, TypeScript (strict) everywhere, Node 22 LTS.
- `apps/web`: React + Vite + Tailwind CSS, React Router, TanStack Query, react-i18next.
- `apps/api`: Fastify + Zod (validation) + Prisma + PostgreSQL (pgvector).
- `apps/worker`: Node SQS consumer (same codebase style as api).
- `packages/shared`: Zod schemas, types, constants (meeting-analysis JSON schema lives here).
- `packages/asr`: speech-to-text provider interface + adapters.
- `packages/llm`: Bedrock client, prompts, structured-output validation.
- Tests: Vitest (unit/integration), Playwright (e2e). Lint: ESLint + Prettier.

## Hard invariants (never break these)
1. **Human-in-the-loop:** no side effect (calendar booking, sending a message, creating a
   reminder, deleting data) may execute unless it came from an authenticated user approving a
   `Proposal`. AI/agent tools may ONLY create proposals. Keep invariant tests for this.
2. **Every AI-extracted decision/task carries a source** (transcript segment ids + timestamps).
3. **No fabrication:** unknown owner/date stays `null` and is flagged `needsReview`.
4. **Consent gate:** a meeting cannot be processed until recording consent is confirmed.
5. **Privacy:** raw audio is deleted after transcription (default) or by lifecycle; never log
   transcripts, tokens, or secrets; never commit secrets.
6. **All API routes live under `/api`** (the load balancer routes `/api/*` to the API).
7. **Usage metering:** every paid operation (audio minutes, LLM tokens, embeddings) writes a
   `usage_events` row with real cost.

## Conventions
- Small, typed modules; no `any`; validate all external input with Zod.
- DB access only through Prisma (raw SQL only for pgvector/full-text, inside `*.sql.ts` files).
- Dates: store UTC, display in the user's timezone (default `Africa/Cairo`).
- UI: RTL-first and bilingual (ar/en). Use Tailwind logical utilities (`ms-*`, `me-*`,
  `ps-*`, `pe-*`, `text-start`) instead of left/right. Mixed Arabic/English text must render
  correctly (use `dir="auto"` on user/transcript text).
- Egyptian Arabic UI copy must be natural (not stiff MSA); keep strings in i18n files only.
- Every feature ships with tests. A phase is done only when `pnpm lint`, `pnpm typecheck`,
  `pnpm test` pass and the feature works in the running app.

## Process
- Start every task by reading `docs/SPEC.md` and `docs/DECISIONS.md`.
- If something is ambiguous, choose a sensible default, record it in `docs/DECISIONS.md`
  (one short entry), and continue. Ask the user only for blockers (credentials, paid services,
  product decisions that change scope).
- Never run `terraform apply`, `terraform destroy`, or any command that mutates a real AWS
  account. `terraform fmt` and `terraform validate` are allowed.
- Never add a paid third-party service without asking.
- Commit in small logical commits with clear messages.