# Multi-stage Dockerfile for web (React + Vite)
# Produces an unprivileged Nginx image listening on port 3000
FROM node:22-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy workspace config and package definitions
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @dawwen/web run build

FROM nginxinc/nginx-unprivileged:alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
