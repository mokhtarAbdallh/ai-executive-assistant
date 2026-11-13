# Multi-stage Dockerfile for worker (SQS consumer + audio pipeline)
# Same runtime contract as apps/api/Dockerfile (ADR-021): workspace sources are
# bundled into dist by tsup; runner installs prod deps only and generates the
# Prisma client from the copied schema. ffmpeg is required for the 16 kHz mono
# WAV pre-processing + chunked ASR (ADR-018).
FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/asr ./packages/asr
COPY packages/llm ./packages/llm
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm --filter @dawwen/db exec prisma generate \
    && pnpm --filter @dawwen/worker run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install ffmpeg for audio chunking/normalization
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/prisma ./packages/db/prisma
COPY packages/asr/package.json ./packages/asr/package.json
COPY packages/llm/package.json ./packages/llm/package.json
COPY apps/worker/package.json ./apps/worker/package.json

# Prod-only dependencies + Prisma client generation into the workspace store.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts --shamefully-hoist \
    && pnpm --filter @dawwen/db exec prisma generate

COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
# Bundled BedrockLlmClient resolves ../prompts relative to dist (same as api).
COPY packages/llm/src/prompts ./apps/worker/prompts

USER node
CMD ["node", "apps/worker/dist/main.js"]
