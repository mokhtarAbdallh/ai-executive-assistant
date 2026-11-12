# Architecture Decision Records — Dawwen (دوّن)

One short entry per decision. Newer entries may supersede older ones (marked explicitly).

---

## ADR-001: Monorepo & tooling

- **Decision:** pnpm workspaces, strict TypeScript, Node 22 LTS pinned for containers/CI (`.nvmrc`, `engines`); local Node 24 is tolerated.
- Layout: `apps/{web,api,worker}`, `packages/{shared,config,asr,llm}`.
- Workspace packages are consumed **from TypeScript source** through a custom `source` export
  condition (TS `customConditions`, Vite/Vitest `resolve.conditions`, tsx `--conditions`, tsup/esbuild).
  No per-package build step is needed in dev; apps are bundled for production.

## ADR-002: Infrastructure contract (`infra/terraform/`)

- api: port **8080**, `GET /api/health` → 200, all routes under `/api`.
- web: nginx (unprivileged) on port **3000**, `GET /` → 200, SPA fallback. Vite dev on **5173**.
- worker: no port; long-polls `AUDIO_QUEUE_URL` (visibility 900s, DLQ after 3 receives).
- Upload key: `uploads/{userId}/{meetingId}/{filename}`; S3 event keys are URL-decoded (`+` → space).
- Prisma `DATABASE_URL` is **built at startup** from `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`
  (password URL-encoded; `sslmode=require` in production).

## ADR-003: Authentication

- `AuthProvider` interface with `local` (argon2 + JWT) and `cognito` (JWKS verification).
- Cognito is not in Terraform yet → `local` is the MVP default in every environment; Cognito
  resources may be added in Phase 7 (supersedes the earlier "cognito in prod" wording).
- Access JWT is kept in memory in the SPA; refresh token in an `httpOnly`, `Secure`,
  `SameSite=Strict` cookie scoped to `/api/auth`.

## ADR-004: Human-in-the-loop proposals

- AI/agent code may only insert `Proposal` rows (`PENDING_APPROVAL`).
- State machine: `PENDING_APPROVAL → APPROVED → EXECUTED | FAILED`, or `PENDING_APPROVAL → REJECTED`.
- The executor runs in the API, only after an authenticated approval, and executes at most once
  (conditional status update). Covered by invariant tests.

## ADR-005: Speech-to-text

- `SpeechToText` interface; adapters `elevenlabs` (primary), `fake` (dev/tests), stubs
  `speechmatics`, `whisper-http`, `transcribe`. Selected by `ASR_PROVIDER`.
- Post-processing keeps English terms in Latin script (configurable policy).

## ADR-006: Database & search

- Aurora PostgreSQL / local `pgvector/pgvector:pg16`; Prisma for all access; raw SQL only in `*.sql.ts`.
- `vector` column is `Unsupported("vector")` in Prisma; dimension comes from `EMBEDDING_DIM`
  (default 1024) and is fixed by migration. Changing the embeddings model = new migration + re-embed.
- Keyword search: Postgres FTS with the `simple` config + `pg_trgm` (no Arabic dictionary exists).

## ADR-007: Frontend

- Tailwind CSS **v4** (native logical utilities), React Router, TanStack Query, react-i18next.
- Arabic (`ar`, RTL) is the default locale; `dir="auto"` on user/transcript text.
- Calendar library: **FullCalendar** (standard MIT views, `direction: 'rtl'`, `ar` locale).
- Google tokens encrypted with AES-256-GCM, key derived via HKDF from `APP_SECRET`, behind a
  `KeyProvider` interface so KMS can replace it.

## ADR-008: Demo mode

- `DEMO_MODE=true` + `ASR_PROVIDER=fake` + `LLM_PROVIDER=fake` → the full flow runs offline.
- LocalStack (pinned `3.8`, free community image) emulates S3 + SQS (+ DLQ, notification, CORS).

## ADR-009: New container env vars (documented Terraform change)

- Added to `ecs.tf` (api + worker) from new `variables.tf` entries: `BEDROCK_MODEL_ID`,
  `BEDROCK_EMBEDDING_MODEL_ID`, `EMBEDDING_DIM`, `AUTH_PROVIDER`, `ASR_PROVIDER`, `LLM_PROVIDER`,
  `DEMO_MODE`, `PUBLIC_BASE_URL`, `PRICING_CONFIG`.
- Model ids and pricing have **no Terraform defaults** (must be supplied in tfvars); nothing is hardcoded in code.
- Local-only: `AWS_ENDPOINT_URL` (LocalStack), never set in ECS.

## ADR-010: Working within current IAM (no new permissions for now)

- API cannot delete S3 objects or send SQS messages; worker cannot write S3, read the DLQ, use SES,
  or read `GOOGLE_OAUTH`. Therefore:
  - Meeting/account **deletion of S3 objects is done by the worker** via a DB deletion job.
  - **Retry** = API flags the meeting in the DB; the worker's DB poller re-processes it.
  - A worker **stale-job sweeper** marks meetings stuck in a processing status as `failed` (with reason).
  - ffmpeg chunks live in local `/tmp` only.
  - **Calendar sync and the proposal executor run in the API.**
  - Notifications use the `console` adapter; the `ses` adapter exists but needs an IAM change to enable.

## ADR-011: Analysis JSON contract

- Canonical shape = the camelCase JSON from the product brief (supersedes SPEC §5.4 snake_case).
- `topics[]`, `decisions[]`, `actionItems[]` carry `sourceTs` **and** `sourceSegmentIds: string[]`
  (Invariant 2). `owner`/`due` null ⇒ `needsReview: true` (Invariant 3, enforced by schema).

## ADR-012: Upload size enforcement

- Presigned PUT cannot enforce a size range, so the URL is signed with the exact declared
  `ContentLength` (≤ configured max) and `ContentType`; the worker re-checks with `HeadObject`.

## ADR-013: Phase 5 Follow-up, Reminders, Hybrid Search, and Ask Agent Invariants

- **Hard Invariant 1 (HITL):** Action tools in the Ask agent (`propose_event`, `create_reminder`, and follow-up message dispatch) NEVER perform direct external actions. They generate `Proposal` rows with `PENDING_APPROVAL`. Only authenticated user approval via `/api/proposals/:id/approve?execute=true` executes side effects via `ProposalExecutorService`.
- **Hard Invariant 2 (Source Citations):** Answers to questions regarding past meetings cite meeting title + timestamp formatted as `[MM:SS]` alongside transcript segment IDs.
- **Hard Invariant 3 (Honesty & No Fabrication):** For topics with confidence below the threshold or absent from transcripts, the agent returns an honest disclaimer (`honestUnknown: true`, "لم يُذكر هذا الموضوع في الاجتماعات المتوفرة") rather than hallucinating details.
- **Hybrid Search Scoring:** Combines exact term matching, decision/topic title boosts, and keyword match ratio calculation (`matchedKeywords / totalKeywords`) to prevent high score anomalies from single generic common words.
- **Notifications & Follow-ups:** `NotificationProvider` interface backed by `ConsoleNotificationProvider` for local/demo operation without requiring immediate SES IAM mutation.

## ADR-014: Phase 6 Billing, Credits Ledger, PaymentProvider, and Real Data Deletion / Export

- **Pay-as-you-go Ledger & Settlement:** Every user has a tenant-isolated `creditLedger`. Each top-up creates a `CREDIT_TOPUP` transaction; actual meeting processing settles consumption via `CREDIT_SETTLE` referencing the meeting and usage events.
- **Balance Gating Before Processing:**
  - `POST /api/meetings/:id/upload-url` checks the user's available balance (`availableMicros <= 0n` blocks upload with HTTP 402 `Payment Required`).
  - Worker audio pipeline checks available credit balance prior to transcription; if balance is non-positive, fails the meeting with `status: FAILED` and reason `"Balance gate: insufficient credit balance"`.
- **PaymentProvider Abstraction:** Defined `PaymentProvider` interface and implemented `ManualPaymentAdapter` supporting manual/voucher/InstaPay top-ups and instant ledger updates without requiring immediate payment gateway contract changes.
- **Real Data Deletion & GDPR Portability:**
  - `DataManagementService.deleteMeeting`: Deletes meeting database row (cascading all decisions, tasks, transcripts, drafts, proposals), removes pgvector `meeting_embeddings`, and sends `DeleteObjectCommand` to S3 to permanently delete the raw audio.
  - `DataManagementService.deleteAccount`: Deletes user record, user settings, proposals, credit transactions, usage events, all meetings, embeddings, and deletes all S3 audio objects across the user's meetings.
  - `DataManagementService.exportAccountData`: Generates a complete portable JSON export bundle (`dawwen-account-export-*.json`) containing user profile, settings, balance, transaction ledger, usage events, and all meetings.

## ADR-015: Phase 7 Hardening, Security Review, and Infrastructure Contract Adherence

- **Multi-Tenant Authorization (Authz):**
  - Every route and service operation requires `TenantContext` derived from validated JWT tokens or authenticated sessions.
  - Queries strictly filter on `userId` (or `meeting: { userId }`).
  - Cross-tenant access triggers `CrossTenantAccessViolationError` and logs an invariant violation with security context.
- **Injection Prevention:**
  - Zero raw SQL string interpolation in the entire codebase. All SQL queries use Prisma parameterized models and tagged templates (`Prisma.sql`).
  - Search queries sanitize keywords and execute through Prisma's safe query builder.
- **SSRF Hardening:**
  - Outbound HTTP requests (`fetch`) are strictly limited to hardcoded upstream API hosts (`oauth2.googleapis.com`, `www.googleapis.com`, `api.elevenlabs.io`, and AWS SDK clients).
  - Presigned upload URLs are generated by S3 with explicit tenant-scoped keys and strict Content-Type / Content-Length restrictions.
- **Sensitive Data Redaction (Invariant 5):**
  - Structured logging configured in `apps/api/src/logger.ts` redacts authorization headers, cookies, passwords, auth tokens, and raw transcript text.
  - Worker SQS consumer avoids logging unparsed message bodies.
- **Infrastructure Contract Verification (`infra/terraform`):**
  - Ports: Container ports 3000 (web) and 8080 (api) match `alb.tf` target groups and `variables.tf`.
  - Routing: ALB path `/api/*` routed to API service; health check `/api/health` returns 200 with uptime.
  - S3 prefix: Upload key convention `uploads/{userId}/{meetingId}/{filename}` strictly aligns with S3 lifecycle configuration rule `prefix = "uploads/"`.
  - Environment variables: `common_env` and secrets defined in `ecs.tf` fully satisfy the strict Zod schema in `packages/config/src/env.ts`.
- **E2E Integration Validation:**
  - Fully automated Playwright test suite (`e2e/dawwen.spec.ts`) verifies end-to-end functionality in a real browser: RTL direction, Arabic/English bilingual toggle, meeting review, HITL proposal confirmation, billing top-up, and GDPR data export.

## ADR-016: Web design system — semantic tokens, explicit themes, bilingual typography

The frontend was rebuilt around a small, explicit design system instead of per-screen ad-hoc
colors. The goal is that every screen (list, calendar, billing, settings, dialogs) shares one
visual language in both themes and both languages.

- **Semantic tokens (Tailwind v4 `@theme`):** screens use `bg-app`, `bg-surface`, `bg-raised`,
  `text-fg`, `text-fg-muted`, `text-fg-subtle`, `border-line`, `border-line-strong`,
  `bg-brand` and the semantic `success` / `warning` / `danger` / `info` colors. One neutral
  scale + one brand accent (`#6C5CF6` dark, `#5545E0` light); green/amber/red/blue are reserved
  for meaning (approved, needs review, destructive, in-progress) and never used decoratively.
- **Theming is explicit, not media-driven:** `<html data-theme="dark|light">` is set by an
  inline bootstrap script in `index.html` before first paint (key `dawwen_theme` in
  localStorage), then owned by `useTheme()` in `lib/theme.ts`. A `@custom-variant dark` is bound
  to `[data-theme]`; there is no `prefers-color-scheme` branch, so the app cannot render a
  half-light/half-dark UI. Dark is the default.
- **Bilingual typography:** `IBM Plex Sans Arabic` for Arabic, `Inter` for Latin, loaded from
  Google Fonts; `--font-sans` lists the Arabic face first so mixed AR/EN text keeps a
  consistent baseline. Type scale is 14px body, 12px for secondary UI text and 11px only for
  chips/metadata. All numbers and tables use `tabular-nums` (`.tabular`).
- **Digit policy:** the UI always uses Latin/Western digits, in both languages, via the
  `ar-EG-u-nu-latn` locale. Arabic month/weekday names are kept (e.g. `23 أكتوبر 2026`), so the
  copy reads Arabic while figures stay unambiguous and aligned. All date/number/money
  formatting goes through `lib/format.ts` (default timezone `Africa/Cairo`).
- **Direction and layout:** `html[dir]` is switched with the language, and layout uses logical
  utilities only (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`). User and
  transcript text uses `dir="auto"` so mixed Arabic/English lines render correctly.
- **Copy:** all user-facing strings live in `apps/web/src/i18n/locales/{ar,en}.json` with
  identical key sets. Count-sensitive strings avoid i18next plural forms (`{{count}}`) where
  Arabic grammar would read badly; neutral phrasings such as `النتايج: {{value}}` are preferred.
- **Interaction primitives:** native `alert` / `confirm` / `prompt` were replaced by
  `ToastProvider` + `useToast`, `ConfirmDialog` (with type-to-confirm for destructive actions),
  `ReasonDialog` for rejection reasons, and an accessible `Modal` (portal, focus trap, Esc,
  scroll lock). Destructive flows are never one-click.
- **No fabricated metrics:** the previous "×2.5 time saved" KPI was removed. Dashboard numbers
  are derived from real data (meetings, decisions, tasks, recorded duration) and the pending
  proposals badge comes from `fetchProposals()`.

## ADR-017: Cognito auth, Google OAuth, and env contract hardening

- `AUDIO_BUCKET` (not a display name) is the single bucket variable; the same S3Client is
  injected into both upload routes and `DataManagementService` so signing and deletion hit the
  same bucket.
- `ASR_PROVIDER` accepts `qwencleo-http` alongside the SaaS providers. Credential rules are
  centralized in `packages/config/src/env.ts`: `isHttpAsrProvider` (self-hosted, optional shared
  key `ASR_HTTP_API_KEY`) vs `isKeyedAsrProvider` (requires `ASR_API_KEY`).
- `AUTH_PROVIDER=cognito` must come with `COGNITO_USER_POOL_ID`; the local mock pool only exists
  outside production.
- Google OAuth redirect base is `PUBLIC_BASE_URL` (never the container-internal address).
- The demo `/process-demo` endpoint and demo login are registered only when `NODE_ENV != production`
  or `DEMO_MODE=true`; the seed password (`DawwenDemo2026!`) is shared with the demo login form.
- `CORS_ORIGINS` is injected by ECS (per-environment origins), never hard-coded in the image.

## ADR-018: QwenCleo HTTP adapter — chunked transcription for real timestamps

- The official QwenCleo FastAPI server (`POST /v1/transcribe`) returns `{"text","language"` only —
  no timestamps or diarization (verified from `server/app.py` upstream source).
- Because Invariant 2 requires per-segment timestamps, the worker uses `transcribeChunked()`:
  ffmpeg re-encodes the upload to 16 kHz mono WAV (stdin pipe), cuts ~20 s chunks
  (`ASR_HTTP_OPTIONS.chunkSeconds`, no overlap in the MVP — upstream recommends 2 s overlap, a
  possible later refinement), and synthesizes segment timestamps from chunk ranges. If ffmpeg is
  unavailable the original bytes go through as one whole-file segment (transparent fallback).
- Language hints map Egypt- dialect / code-switched meetings to `"Arabic"` (model-card
  recommendation), English meetings to `"English"`.
- The ElevenLabs SaaS adapter stays available in parallel for the ASR bake-off; a WER bake-off
  on real Egyptian recordings decides the production ASR before GPU deployment.

## ADR-019: Stuck-meeting sweeper

- Message metadata (SQS visibility timeout / maxReceiveCount → DLQ) cannot settle a half-finished
  pipeline: after retry exhaustion the message is dropped and the meeting row stays in
  `TRANSCRIBING`/`ANALYZING` forever.
- The worker runs an idempotent sweeper (`apps/worker/src/sweeper.ts`) that bulk-marks stale
  meetings in those two statuses as `FAILED` with an explanatory `failureReason` once
  `updatedAt` is older than `STUCK_MEETING_MINUTES`; interval is `STUCK_SWEEP_SECONDS`
  (0 disables). DONE/FAILED rows are never touched.

## ADR-020: Reminder dispatcher — booking-free, send-then-claim

- Due `SCHEDULED` reminders are delivered **send-then-claim**: the email goes out first and only
  then does a status-guarded `updateMany` (`WHERE status=SCHEDULED`) mark it `SENT`. Rationale: a
  duplicated reminder (crash between send and claim) is an annoyance, while a silently dropped one
  (claim-then-send semantics) is a missed meeting. A lost claim race (`count=0`) skips the
  duplicate send in multi-replica deployments; in the single-replica worker it is a no-op.
- Delivery channel: `EMAIL_FROM` configured → `SesEmailSender` (`@aws-sdk/client-sesv2`, Simple
  content, UTF-8); otherwise the default console channel still marks reminders `SENT` so dispatch
  works with zero SES permissions in dev. A failed send leaves the reminder `SCHEDULED` so the
  next dispatch retries it.
- **CloudWatch:** `alarms.tf` adds an SNS topic + `alarm_email` subscription; DLQ-oldest-age
  (> 900 s) and audio-queue backlog alarms page when messages move to the DLQ (i.e. the sweeper
  path was exercised).

## ADR-021: Container runtime contract — bundle + generated Prisma client

- tsup bundles all `@dawwen/*` workspace source into a single `dist/main.js`
  (`noExternal: /^@dawwen\//`, `conditions=source`); npm dependencies stay external. The old
  Dockerfiles copied only `packages/{config,shared}` — both images failed to build and run.
  The images now copy `packages/{config,shared,db,asr,llm}`.
- Runner stages install **prod-only** dependencies against the workspace manifests and then
  generate the Prisma client from the copied `packages/db/prisma/schema.prisma`
  (`pnpm --filter @dawwen/db exec prisma generate`). Consequently `prisma` became a **regular**
  dependency of `@dawwen/db` (not dev) so the CLI exists in prod installs.
- The bundled `BedrockLlmClient` resolves the analysis prompt relative to the bundle
  (`dist` → `../prompts`), so `packages/llm/src/prompts` is copied to `apps/api/prompts` and
  `apps/worker/prompts`.
- Worker runtime image includes ffmpeg for the ADR-018 audio pre-processing.

## ADR-022: Phase-1 hardening — exactly-once proposals, atomic credits, admin top-up, real web auth

- **Proposals:** new `EXECUTING` status. Execution first claims the row with a conditional
  `updateMany` (`APPROVED → EXECUTING`); only the single winner runs the side effect, then marks
  `EXECUTED` or `FAILED`. Concurrent/duplicate approvals get **409**; cross-tenant ids get **404**.
- **Credits:** reserve and settle are single conditional SQL statements (`credit.sql.ts`).
  Reserve fails instead of over-committing; settle charges at most the available balance and
  reports the shortfall (logged by the worker) — the balance never goes negative.
  Reserve-before-processing in the worker is deferred to Phase 2.
- **Top-up:** only users with `users.isPlatformAdmin` (re-read from the DB per request) may
  credit an account, addressed by `userEmail`; capped at $100k per call. Grant with
  `pnpm --filter @dawwen/db admin:grant <email> [--revoke]`. `/api/auth/me` exposes the flag so
  the UI shows the admin form; regular users see transfer instructions only.
- **Web auth:** real login/register screen; the access token is sent as Bearer and refreshed once
  per 401 (shared in-flight) through the httpOnly refresh cookie; failed refresh → login screen.
  Credential endpoints (login/register/refresh/logout) never trigger a refresh.
- **Demo data** (auto-login + sample fallbacks) is served only when built with
  `VITE_DEMO_MODE=true`; otherwise every API failure surfaces as an error. Playwright starts its
  own demo dev server on port 5175.
- **Tests:** real-Postgres concurrency tests (`*.db.test.ts`, gated by `TEST_DATABASE_URL`) run in
  CI against a pgvector service after `prisma migrate deploy`.
- Cognito stays off (local JWT auth) for now; server-side refresh-token revocation is Phase 2.
