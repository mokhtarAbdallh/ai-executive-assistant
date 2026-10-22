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
