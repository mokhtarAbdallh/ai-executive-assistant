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

## ADR-023: Phase-2 pipeline reliability, honest execution, OAuth and session revocation

- **Claim-once processing:** the worker claims a meeting with `QUEUED → TRANSCRIBING` (conditional
  update). Duplicate SQS deliveries and redrives of non-queued meetings are skipped and deleted.
- **Credit hold:** after measuring the audio (ffprobe; 1-minute estimate when unknown, raised after
  ASR) the worker reserves `price × minutes` before paying for ASR/LLM, records it in
  `meetings.creditHoldMicros`, and settles it against the real cost (capped, ADR-022) at the end.
  Failures release the hold without charging; the sweeper releases holds of crashed runs.
- **Clean retries:** a run first deletes partial results of earlier attempts (segments, embeddings,
  analysis, tasks, decisions, pending AI proposals, …). Analysis + children + proposal +
  `REVIEW_PENDING` are written in one transaction. Any failure → `FAILED` + user-safe reason; audio
  is kept. `POST /api/meetings/:id/retry` re-queues a FAILED meeting (conditional FAILED → QUEUED,
  then SQS `SendMessage`; the API role gained `sqs:SendMessage`) and the UI shows a retry button.
- **Metering:** `LlmAnalysisFailedError` carries the tokens of failed Bedrock attempts, which are
  written as `LLM_ANALYSIS` usage with `failed: true` (Invariant 7).
- **Privacy/audit:** raw-audio retention defaults to 0 days (Invariant 5); deleting a meeting keeps
  its usage events (`usage_events.meetingId` FK `ON DELETE SET NULL`).
- **Honest execution:** proposals are validated before approval — booking needs a real date and a
  connected calendar, email a real recipient/body, a reminder its time, a task its meeting —
  otherwise `422 proposal_incomplete | calendar_not_connected | email_not_configured` and the
  proposal stays pending. No default dates/recipients. Simulated channels (fake calendar, console
  email) only when `NODE_ENV !== production` or `DEMO_MODE=true`. Approving a reminder schedules it;
  the worker dispatcher sends it when due.
- **Google OAuth:** `state` is HMAC-signed (key derived from `APP_SECRET`), bound to the user and
  valid for 10 minutes; `GET /api/calendar/callback` (no Bearer) verifies it, stores the encrypted
  tokens and redirects to `/?calendar=connected|error`. The old authenticated POST callback (which
  accepted an arbitrary `redirectUri`) is removed.
- **Sessions:** refresh tokens are rows in `refresh_tokens` (jti). Each refresh rotates
  (`replacedBy`), logout revokes, and reuse of a rotated token revokes all of the user's sessions —
  except within 30 s when two tabs refresh with the same cookie.
- API replies serialize `BigInt` as strings (global reply serializer).
- Deferred: transient-error auto-retry in the worker (today: user/ops retry), a real email channel
  in the API, Cognito.

## ADR-024: Phase-3 quality — grounded citations, cleaner API, faster ASR, real assistant

- **Citations are verified (Invariant 2):** Bedrock output that cites a `sourceSegmentId` not in
  the transcript is sent back for repair; after the last attempt the worker strips unknown ids and
  drops items left without a source (`enforceValidCitations`).
- **One error handler:** another tenant's row and missing rows → `404 {error:"not_found"}` (never
  500, never "forbidden"); `ZodError` → 400; Fastify client errors keep their status; anything else
  → generic `500 {error:"internal_error"}` without the internal message. Query strings
  (meetings, billing, calendar events, search) are parsed with Zod.
- **Meetings pagination:** `GET /api/meetings?limit=1..100&cursor=…` is keyset-paginated on
  `(createdAt desc, id desc)`; the body stays an array and the next cursor is in `x-next-cursor`.
  The web list shows "show older meetings".
- **ASR:** the worker streams the S3 object to a temp file, cuts 16 kHz WAV chunk files with
  ffmpeg and passes their paths (no whole recording in memory). Chunks after the first start
  `overlapSeconds` (default 2) early; the repeated words are removed at merge time
  (`removeOverlapPrefix`, keeps the text when nothing matches). QwenCleo transcribes
  `concurrency` (default 4) chunks at once and merges them in order. Both are
  `ASR_HTTP_OPTIONS` keys (supersedes "no overlap" in ADR-018). Temp files are deleted after ASR.
- **Assistant:** with `LLM_PROVIDER=bedrock` the Ask chat runs a Converse tool loop (≤ 6 rounds)
  over `search_meetings`, `get_tasks`, `draft_message`, `create_reminder`, `propose_event`.
  Action tools only create drafts / `PENDING_APPROVAL` proposals and never fill in a date or
  recipient the user did not give (null + `needsReview`; approval is refused until set). Dates are
  wall-clock in the user's `timezone` setting (default `Africa/Cairo`, DST-aware) and converted to
  UTC. Each model call writes an `LLM_CHAT` usage event with its cost. Without a model the same
  tools back a rule-based fallback for dev/demo.
- Deferred: a balance gate for chat tokens, metering of query embeddings in search, speaker
  diarization for the self-hosted ASR.

## ADR-025: Phase-4 operations — runnable locally, deployable on ECS, measurable before pricing

- **Database URL on ECS:** Terraform injects `DB_*` parts, not `DATABASE_URL`. API and worker pass
  `config.databaseUrl` to `getPrismaClient(datasourceUrl)`; nothing creates a client at import time.
  Migrations run as a one-off ECS task (`terraform output migrate_command`, script
  `packages/db/scripts/migrate-deploy.mjs`, `sslmode=require` in prod, URL never printed).
- **Presigned uploads:** S3 clients use `requestChecksumCalculation/responseChecksumValidation =
WHEN_REQUIRED`; otherwise the SDK signs a CRC32 of an empty body and S3 rejects browser PUTs.
- **Local stack:** compose ports are overridable (`DAWWEN_PG_PORT`, `DAWWEN_LOCALSTACK_PORT`);
  the LocalStack init script is idempotent (bucket, CORS, queue + DLQ, S3→SQS on `uploads/`).
- **Full-stack e2e:** `pnpm test:e2e:fullstack` drives login → upload with consent → processing →
  approve all → approve a proposal against the real API, worker, Postgres and LocalStack (fake
  ASR/LLM). It runs in CI as job `e2e`.
- **Lost uploads:** meetings left `QUEUED` for 6 hours (upload interrupted, job lost) are marked
  `FAILED` with an "upload it again" reason by the worker sweep.
- **ASR bake-off:** `pnpm --filter @dawwen/worker bakeoff --dir <recordings>` runs each provider
  through the production audio path and reports pooled WER/CER (after normalising Arabic spelling
  variants, digits, punctuation), real-time factor and cost per audio hour. The report contains
  transcripts and is git-ignored (`bakeoff-results/`). The ASR decision is made from it.
- **Cost per minute:** `pnpm --filter @dawwen/worker cost-report --fixed-usd <bill>` divides metered
  cost (usage_events) plus fixed AWS cost by billed audio minutes and shows revenue and margin.
  `.env.example` Bedrock prices were 1000× too low and now match Terraform. The ElevenLabs price
  differs between Terraform (183 333 µ$/min) and `.env.example` (3 667 µ$/min); the owner must set
  the real plan price before go-live.
- **Production Terraform:** WAF on the ALB (rate limit per IP + AWS common / bad-inputs /
  IP-reputation rules; body-size rule counts only), SES identity + `ses:SendEmail` for the worker
  when `email_from` is set (it had no permission before), alarms for API 5xx, unhealthy API
  targets and Aurora capacity, optional monthly AWS budget. Backups were already 14 days with
  deletion protection in prod. Go-live steps are in RUNBOOK §8.

## ADR-026: Learner Lab test deployment on free providers (branch `test/learner-lab` only)

- **Why:** testing on the AWS Academy Learner Lab ($50 budget, us-east-1/us-west-2, no IAM role
  creation, no Bedrock/Transcribe/SES) with no paid AI. Production (ADR-025, Terraform) is unchanged;
  this branch only adds options.
- **Hosting:** one EC2 server (`deploy/lab/`): Caddy (free Let's Encrypt HTTPS on `<ip>.sslip.io`)
  in front of web + API; worker; Postgres + pgvector in Docker (`DB_SSL=false`). Real S3 + SQS
  created by `aws-resources.sh` with the instance's `LabRole` (no AWS keys; metadata hop limit 2 so
  containers get the role). Raw audio expires after 7 days by lifecycle as a backstop.
- **ASR:** `ASR_PROVIDER=openai-whisper` — any OpenAI audio API (Groq `whisper-large-v3`, free tier).
  Uses the chunked path (120 s chunks, 2 s overlap) and Whisper's own segment timestamps, so
  citations point at sentences; lead-in segments and `no_speech_prob > 0.6` segments are dropped.
  No diarization (every segment is "Speaker 1"). 429/5xx are retried with Retry-After.
- **LLM + embeddings:** `LLM_PROVIDER=openai-compatible` with `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`
  and optional `LLM_EMBEDDING_MODEL` (Gemini `gemini-2.5-flash`, `gemini-embedding-001` at 1024
  dims to match the pgvector column). Same prompt, schema validation, citation check and repair loop
  as Bedrock. The assistant uses its rule-based fallback (no tool-use model on this provider).
- **Meeting date in the prompt:** the adapter sends the meeting day (Cairo) so "Thursday" or
  "tomorrow" resolve to real dates. Found in a live test: without it the model wrote 2023 dates.
  **The Bedrock adapter on the main line has the same gap and should get the same fix.**
- `COOKIE_SECURE=false` exists only for a plain-HTTP fallback. Provider costs are 0 in
  `PRICING_CONFIG`; customers are still charged per minute from credit.
