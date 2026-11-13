import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API_URL, DATABASE_URL, STACK_ENV } from "./stack-env";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const USER_FILE = resolve(root, "test-results/fullstack-user.json");

async function api(path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Full-stack E2E setup (ADR-025):
 * 1. migrations on the compose Postgres (same script ECS runs),
 * 2. the worker (SQS consumer) — Playwright's webServer only handles HTTP servers,
 * 3. a user with credit: registered through the API and topped up by a platform admin,
 *    the real path (admins are granted with the admin:grant script).
 * Test passwords are random per run and kept in test-results/ (git-ignored).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const migrate = spawnSync("node", ["packages/db/scripts/migrate-deploy.mjs"], {
    cwd: root,
    env: { ...process.env, ...STACK_ENV },
    stdio: "inherit",
  });
  if (migrate.status !== 0) throw new Error("migrations failed (is `docker compose up` running?)");

  const worker: ChildProcess = spawn(
    "pnpm",
    ["--filter", "@dawwen/worker", "exec", "tsx", "--conditions=source", "src/main.ts"],
    {
      cwd: root,
      env: { ...process.env, ...STACK_ENV },
      // Worker logs are structured and never contain transcripts (Invariant 5): show them
      // so a CI failure says why processing stalled.
      stdio: ["ignore", "inherit", "inherit"],
      shell: process.platform === "win32",
    },
  );

  const stamp = Date.now();
  const password = randomBytes(12).toString("hex");
  const email = `e2e-${stamp}@test.local`;
  const adminEmail = `e2e-admin-${stamp}@test.local`;
  await api("/auth/register", { email, password, name: "مستخدم الاختبار" });
  await api("/auth/register", { email: adminEmail, password, name: "E2E admin" });
  const grant = spawnSync(
    "pnpm",
    ["--silent", "--filter", "@dawwen/db", "admin:grant", adminEmail],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL },
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (grant.status !== 0) throw new Error("admin:grant failed");
  const admin = await api("/auth/login", { email: adminEmail, password });
  await api("/billing/topup", { userEmail: email, amountDollars: 5 }, admin.accessToken as string);

  mkdirSync(dirname(USER_FILE), { recursive: true });
  writeFileSync(USER_FILE, JSON.stringify({ email, password }));

  return async () => {
    if (worker.pid === undefined) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(worker.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      worker.kill("SIGTERM");
    }
  };
}
