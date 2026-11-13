#!/usr/bin/env node
/**
 * Applies Prisma migrations (ADR-025). Runs inside the API image as a one-off ECS task, where
 * Terraform injects DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD but no DATABASE_URL:
 *
 *   aws ecs run-task ... --overrides '{"containerOverrides":[{"name":"api",
 *     "command":["node","packages/db/scripts/migrate-deploy.mjs"]}]}'
 *
 * Locally it also works with a plain DATABASE_URL. The URL (with the password) is never printed.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schema = resolve(here, "../prisma/schema.prisma");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { DB_HOST, DB_PORT = "5432", DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  const missing = Object.entries({ DB_HOST, DB_NAME, DB_USER, DB_PASSWORD })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    console.error(`migrate-deploy: missing ${missing.join(", ")} (or DATABASE_URL)`);
    process.exit(2);
  }
  const params = new URLSearchParams({ schema: "public" });
  // DB_SSL=false: Postgres on the same server without TLS (Learner Lab, ADR-026).
  const ssl = process.env.DB_SSL
    ? process.env.DB_SSL === "true"
    : process.env.NODE_ENV === "production";
  if (ssl) params.set("sslmode", "require");
  return `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${encodeURIComponent(DB_NAME)}?${params}`;
}

const result = spawnSync(
  "npx",
  ["--no-install", "prisma", "migrate", "deploy", "--schema", schema],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    cwd: resolve(here, ".."),
    shell: process.platform === "win32",
  },
);
process.exit(result.status ?? 1);
