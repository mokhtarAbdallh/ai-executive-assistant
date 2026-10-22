# Multi-stage Dockerfile for api (Fastify)
# Listens on port 8080
FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @dawwen/api run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install minimal production dependencies
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config/package.json ./packages/config/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install --prod --ignore-scripts

COPY --from=builder /app/apps/api/dist ./apps/api/dist

USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
