import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = 5175;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${E2E_PORT}`,
    trace: "on-first-retry",
    headless: true,
  },
  // The UI suite runs against the offline demo build (no API behind it). Demo data is
  // only served when VITE_DEMO_MODE=true (ADR-022); real builds require login.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @dawwen/web dev --port ${E2E_PORT} --strictPort`,
        url: `http://localhost:${E2E_PORT}`,
        env: { VITE_DEMO_MODE: "true" },
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
