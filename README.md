# Dawwen (دوّن) — AI Meeting Assistant

مساعد شخصي ذكي بالذكاء الاصطناعي للاجتماعات التي تستخدم العامية المصرية والإنجليزية المختلطة (Code-Switched Meetings).

---

## Architecture Overview

```
apps/
  web/         # React 19 + Vite + Tailwind CSS v4 (port 5173 / 3000)
  api/         # Fastify + Zod + Prisma (port 8080)
  worker/      # SQS consumer + audio processing pipeline with ffmpeg
packages/
  config/      # Validated environment loader & DATABASE_URL builder
  shared/      # Zod schemas (analysis output JSON contract, proposals, usage)
  asr/         # Speech-to-Text provider interface + adapters
  llm/         # Bedrock Converse client & prompt templates
infra/
  terraform/   # AWS production infrastructure (ECS Fargate, ALB, Aurora, S3, SQS)
```

---

## Quickstart (Local Development)

### 1. Prerequisites
- Node.js 22 LTS (or 24)
- pnpm >= 9.12.0
- Docker & Docker Compose

### 2. Start Local Infrastructure
Run PostgreSQL (with `pgvector`) and LocalStack (S3 & SQS):
```bash
docker compose up -d
```

### 3. Install Dependencies
```bash
pnpm install
```

### 4. Run Development Services
```bash
pnpm dev
```
- Web: `http://localhost:5173`
- API: `http://localhost:8080/api/health`

### 5. Quality & Test Commands
```bash
pnpm lint        # Run ESLint across all workspaces
pnpm typecheck   # Typecheck without emit across all workspaces
pnpm test        # Run Vitest unit & invariant tests
```

---

## Hard Invariants
1. **Human-in-the-loop**: All automated AI tools only create `Proposal` records (`PENDING_APPROVAL`). Side effects execute strictly after authenticated user approval.
2. **Transcript Source Attribution**: Every extracted decision and action item cites exact transcript segment IDs and timestamps.
3. **No Fabrication**: Missing owners or dates remain `null` and are flagged `needsReview: true`.
4. **Consent Gate**: Meetings cannot be uploaded or processed without explicit recording consent.
5. **Privacy**: Raw audio is deleted after transcription or purged via lifecycle retention rules.
6. **API Prefix**: All API routes live under `/api/*` matching the ALB routing contract.
7. **Usage Metering**: Every paid operation writes a `usage_events` record with real cost in USD micros.
