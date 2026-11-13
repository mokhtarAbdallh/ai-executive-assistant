/**
 * Cost per audio minute from usage_events (ADR-025). Read-only.
 *
 *   pnpm --filter @dawwen/worker cost-report --from 2026-11-01 --to 2026-12-01 --fixed-usd 180
 *
 * --fixed-usd  fixed AWS infrastructure cost for the same period (Cost Explorer, excluding
 *              Bedrock which is already metered). Default 0.
 * Needs DATABASE_URL (from .env locally; for AWS, an SSM port-forward to Aurora, see RUNBOOK).
 */
import { parseArgs } from "node:util";
import { getPrismaClient } from "@dawwen/db";
import { loadDotEnvForDev } from "@dawwen/config";
import { buildCostReport, renderCostReport } from "../src/cost-report.js";

async function main(): Promise<void> {
  loadDotEnvForDev();
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      to: { type: "string" },
      "fixed-usd": { type: "string", default: "0" },
    },
  });
  const to = values.to ? new Date(values.to) : new Date();
  const from = values.from ? new Date(values.from) : new Date(to.getTime() - 30 * 86_400_000);
  const fixedCostUsd = Number(values["fixed-usd"]);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || Number.isNaN(fixedCostUsd)) {
    console.error("usage: cost-report [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--fixed-usd N]");
    process.exit(2);
  }

  const prisma = getPrismaClient();
  try {
    const events = await prisma.usageEvent.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { operationType: true, unit: true, quantity: true, costMicros: true, metadata: true },
    });
    console.log(renderCostReport(buildCostReport(events, { fixedCostUsd }), { from, to }));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
