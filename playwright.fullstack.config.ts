import { defineConfig, devices } from "@playwright/test";
import { API_URL, STACK_ENV, WEB_PORT } from "./e2e-fullstack/stack-env";

/**
 * Full-stack E2E (ADR-025): real API + worker + web against the docker-compose stack
 * (Postgres + LocalStack S3/SQS) with the fake ASR/LLM. Needs `docker compose up -d --wait`.
 *
 *   pnpm test:e2e:fullstack
 *
 * The default `pnpm test:e2e` suite stays the offline demo build (playwright.config.ts).
 */
export default defineConfig({
  testDir: "./e2e-fullstack",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  globalSetup: "./e2e-fullstack/global-setup.ts",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    headless: true,
  },
  webServer: [
    {
      command: "pnpm --filter @dawwen/api exec tsx --conditions=source src/main.ts",
      url: `${API_URL}/api/health`,
      env: STACK_ENV,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @dawwen/web dev --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_DEMO_MODE: "false" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
