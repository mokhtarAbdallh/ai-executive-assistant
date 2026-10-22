import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Development convenience: load the repo-root `.env` if present. Never used in production —
 * ECS injects variables directly. Existing environment variables are not overridden.
 */
export function loadDotEnvForDev(): void {
  if (process.env.NODE_ENV === "production") return;
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  const file = candidates.find((p) => existsSync(p));
  if (file) process.loadEnvFile(file);
}
