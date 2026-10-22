import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CreditRepository, InsufficientBalanceError } from "../src/repositories/credit.repository.js";

describe("Credit Ledger (Usage & Balance Invariant)", () => {
  const context = { userId: "user-test-credit-1" };

  it("calculates available balance correctly (balance - reserved)", async () => {
    const mockPrisma = {
      creditLedger: {
        upsert: vi.fn().mockResolvedValue({
          userId: context.userId,
          balanceMicros: 5_000_000n, // $5.00
          reservedMicros: 1_500_000n, // $1.50
        }),
      },
    } as unknown as PrismaClient;

    const repo = new CreditRepository(mockPrisma);
    const balance = await repo.getBalance(context);

    expect(balance.balanceMicros).toBe(5_000_000n);
    expect(balance.reservedMicros).toBe(1_500_000n);
    expect(balance.availableMicros).toBe(3_500_000n); // $3.50 available
  });

  it("rejects reservation if requested credits exceed available balance", async () => {
    const mockTx = {
      creditLedger: {
        upsert: vi.fn().mockResolvedValue({
          userId: context.userId,
          balanceMicros: 1_000_000n,
          reservedMicros: 800_000n, // available = 200,000n
        }),
        update: vi.fn(),
      },
      creditTransaction: {
        create: vi.fn(),
      },
    };

    const mockPrisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
    } as unknown as PrismaClient;

    const repo = new CreditRepository(mockPrisma);

    // Requesting 500,000 micros when available is only 200,000 throws InsufficientBalanceError
    await expect(
      repo.reserveCredits(context, 500_000n, "Reserve audio processing"),
    ).rejects.toThrow(InsufficientBalanceError);

    expect(mockTx.creditLedger.update).not.toHaveBeenCalled();
    expect(mockTx.creditTransaction.create).not.toHaveBeenCalled();
  });
});
