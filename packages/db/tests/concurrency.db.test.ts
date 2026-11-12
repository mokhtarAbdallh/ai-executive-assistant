/**
 * Real-Postgres concurrency tests (ADR-022). Mocks cannot reproduce races, so these
 * run against an actual database when TEST_DATABASE_URL is set (CI provides one):
 *
 *   TEST_DATABASE_URL=postgresql://dawwen:dawwen@localhost:55432/dawwen_test pnpm --filter @dawwen/db test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, ProposalActionType, ProposalStatus } from "@prisma/client";
import { ProposalRepository } from "../src/repositories/proposal.repository.js";
import {
  CreditRepository,
  InsufficientBalanceError,
} from "../src/repositories/credit.repository.js";
import { ProposalAlreadyClaimedError } from "../src/proposals/state-machine.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("concurrency invariants (real Postgres)", () => {
  let prisma: PrismaClient;
  const userId = `usr-conc-${Date.now()}`;
  const ctx = { userId };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.local`, name: "Concurrency Test" },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("lets exactly one of many concurrent requests claim a proposal for execution", async () => {
    const proposal = await prisma.proposal.create({
      data: {
        userId,
        actionType: ProposalActionType.SCHEDULE_MEETING,
        payload: { title: "race" },
        status: ProposalStatus.APPROVED,
      },
    });
    const repo = new ProposalRepository(prisma);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => repo.claimForExecution(ctx, proposal.id)),
    );

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(9);
    for (const r of lost) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ProposalAlreadyClaimedError);
    }
    const stored = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(stored.status).toBe(ProposalStatus.EXECUTING);
  });

  it("never reserves more credit than is available under concurrent reservations", async () => {
    const repo = new CreditRepository(prisma);
    await prisma.creditLedger.upsert({
      where: { userId },
      create: { userId, balanceMicros: 1_000_000n, reservedMicros: 0n },
      update: { balanceMicros: 1_000_000n, reservedMicros: 0n },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => repo.reserveCredits(ctx, 400_000n, `hold ${i}`)),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientBalanceError);
    }
    const ledger = await prisma.creditLedger.findUniqueOrThrow({ where: { userId } });
    expect(ledger.reservedMicros).toBe(800_000n);
    expect(ledger.balanceMicros).toBe(1_000_000n);
  });

  it("never lets a settlement push the balance below zero", async () => {
    const repo = new CreditRepository(prisma);
    await prisma.creditLedger.update({
      where: { userId },
      data: { balanceMicros: 300_000n, reservedMicros: 0n },
    });

    const settled = await repo.settleCredits(ctx, 0n, 1_000_000n, "usage larger than balance");

    expect(settled.chargedMicros).toBe(300_000n);
    expect(settled.shortfallMicros).toBe(700_000n);
    const ledger = await prisma.creditLedger.findUniqueOrThrow({ where: { userId } });
    expect(ledger.balanceMicros).toBe(0n);
  });
});
