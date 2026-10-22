# Multi-stage Dockerfile for worker (SQS consumer + audio pipeline)
FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @dawwen/worker run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install ffmpeg for audio chunking/normalization
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm install --prod --ignore-scripts

COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

USER node
CMD ["node", "apps/worker/dist/main.js"]
