import { PrismaClient } from "@prisma/client";

declare global {
  var __dawwen_prisma: PrismaClient | undefined;
}

/**
 * @param datasourceUrl Connection URL built from DB_* (ADR-025). On ECS Terraform injects
 *   DB_HOST/DB_PASSWORD/... separately and there is no DATABASE_URL, so the apps must pass it.
 *   Falls back to the DATABASE_URL env (local tools, tests, migrations).
 */
export function getPrismaClient(datasourceUrl?: string): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    return datasourceUrl ? new PrismaClient({ datasourceUrl }) : new PrismaClient();
  }
  if (!global.__dawwen_prisma) {
    global.__dawwen_prisma = datasourceUrl
      ? new PrismaClient({ datasourceUrl, log: ["warn", "error"] })
      : new PrismaClient({ log: ["warn", "error"] });
  }
  return global.__dawwen_prisma;
}

export * from "@prisma/client";
