# Multi-stage Dockerfile for api (Fastify)
# Listens on port 8080
#
# tsup bundles all @dawwen/* workspace source into dist/main.js
# (noExternal: /^@dawwen\//), so at runtime only the npm external dependencies
# plus a GENERATED Prisma client are needed. The runner stage therefore:
#   1.Symlinks-only prod install of the workspace manifests
#     (the copied @dawwen sources are never executed — they are bundled).
#   2. Generates the Prisma client from packages/db/prisma/schema.prisma
#     (prisma is a regular dependency of @dawwen/db — ADR-021).
# The bundled analysis prompt is read via __dirname from apps/api/dist
# resolving to ../prompts => apps/api/prompts (ADR-021), copied below.
FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/asr ./packages/asr
COPY packages/llm ./packages/llm
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm --filter @dawwen/db exec prisma generate \
    && pnpm --filter @dawwen/api run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# ffmpeg-clean runner; corepack provides pnpm for the production install.
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/prisma ./packages/db/prisma
COPY packages/asr/package.json ./packages/asr/package.json
COPY packages/llm/package.json ./packages/llm/package.json
COPY apps/api/package.json ./apps/api/package.json

# Prod-only dependencies + Prisma client generation into the workspace store.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
    && pnpm --filter @dawwen/db exec prisma generate

COPY --from=builder /app/apps/api/dist ./apps/api/dist
# Bundled BedrockLlmClient resolves ../prompts relative to dist.
COPY packages/llm/src/prompts ./apps/api/prompts

USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
