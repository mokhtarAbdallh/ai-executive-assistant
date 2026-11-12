import type { PrismaClient } from "@prisma/client";
import { CreditTransactionType } from "@prisma/client";
import type { TenantContext } from "./base.js";
import { reserveCreditsAtomic, settleCreditsAtomic } from "../credit.sql.js";

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly availableMicros: bigint,
    public readonly requestedMicros: bigint,
  ) {
    super(
      `Insufficient credit balance: available ${availableMicros} micros, requested ${requestedMicros} micros.`,
    );
    this.name = "InsufficientBalanceError";
  }
}

export class CreditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreateLedger(userId: string) {
    return this.prisma.creditLedger.upsert({
      where: { userId },
      create: {
        userId,
        balanceMicros: 0n,
        reservedMicros: 0n,
      },
      update: {},
    });
  }

  async getBalance(context: TenantContext) {
    const ledger = await this.getOrCreateLedger(context.userId);
    const availableMicros = ledger.balanceMicros - ledger.reservedMicros;
    return {
      balanceMicros: ledger.balanceMicros,
      reservedMicros: ledger.reservedMicros,
      availableMicros: availableMicros > 0n ? availableMicros : 0n,
    };
  }

  async addCredits(
    context: TenantContext,
    amountMicros: bigint,
    description: string,
    referenceId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const ledger = await tx.creditLedger.upsert({
        where: { userId: context.userId },
        create: {
          userId: context.userId,
          balanceMicros: amountMicros,
          reservedMicros: 0n,
        },
        update: {
          balanceMicros: { increment: amountMicros },
        },
      });

      await tx.creditTransaction.create({
        data: {
          userId: context.userId,
          amountMicros,
          transactionType: CreditTransactionType.CREDIT_TOPUP,
          description,
          referenceType: "topup",
          referenceId,
        },
      });

      return ledger;
    });
  }

  /**
   * Places a hold on available credit. Atomic (single conditional UPDATE), so
   * concurrent reservations can never exceed the available balance (ADR-022).
   */
  async reserveCredits(
    context: TenantContext,
    amountMicros: bigint,
    description: string,
    referenceId?: string,
  ) {
    if (amountMicros <= 0n) {
      throw new Error("Reservation amount must be positive.");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.creditLedger.upsert({
        where: { userId: context.userId },
        create: { userId: context.userId, balanceMicros: 0n, reservedMicros: 0n },
        update: {},
      });

      const reserved = await reserveCreditsAtomic(tx, context.userId, amountMicros);
      if (!reserved) {
        const ledger = await tx.creditLedger.findUniqueOrThrow({
          where: { userId: context.userId },
        });
        throw new InsufficientBalanceError(
          ledger.balanceMicros - ledger.reservedMicros,
          amountMicros,
        );
      }

      await tx.creditTransaction.create({
        data: {
          userId: context.userId,
          amountMicros: -amountMicros,
          transactionType: CreditTransactionType.CREDIT_RESERVE,
          description,
          referenceType: "meeting_reservation",
          referenceId,
        },
      });

      return tx.creditLedger.findUniqueOrThrow({ where: { userId: context.userId } });
    });
  }

  /**
   * Releases `reservedMicros` and debits `actualMicros`. The debit is capped at
   * what is actually available, so the balance never goes negative; the uncovered
   * part is reported as `shortfallMicros` (and noted on the transaction).
   */
  async settleCredits(
    context: TenantContext,
    reservedMicros: bigint,
    actualMicros: bigint,
    description: string,
    referenceId?: string,
  ): Promise<{
    balanceMicros: bigint;
    reservedMicros: bigint;
    chargedMicros: bigint;
    shortfallMicros: bigint;
  }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.creditLedger.upsert({
        where: { userId: context.userId },
        create: { userId: context.userId, balanceMicros: 0n, reservedMicros: 0n },
        update: {},
      });

      const row = await settleCreditsAtomic(tx, context.userId, reservedMicros, actualMicros);
      if (!row) {
        throw new Error(`Credit ledger missing for user '${context.userId}'.`);
      }
      const chargedMicros = BigInt(row.chargedMicros);
      const shortfallMicros = actualMicros - chargedMicros;

      await tx.creditTransaction.create({
        data: {
          userId: context.userId,
          amountMicros: -chargedMicros,
          transactionType: CreditTransactionType.CREDIT_SETTLE,
          description:
            shortfallMicros > 0n
              ? `${description} (uncovered: ${shortfallMicros} micros)`
              : description,
          referenceType: "meeting_settle",
          referenceId,
        },
      });

      return {
        balanceMicros: BigInt(row.balanceMicros),
        reservedMicros: BigInt(row.reservedMicros),
        chargedMicros,
        shortfallMicros,
      };
    });
  }

  async refundCredits(
    context: TenantContext,
    amountMicros: bigint,
    description: string,
    referenceId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.creditLedger.upsert({
        where: { userId: context.userId },
        create: {
          userId: context.userId,
          balanceMicros: amountMicros,
          reservedMicros: 0n,
        },
        update: {
          balanceMicros: { increment: amountMicros },
        },
      });

      await tx.creditTransaction.create({
        data: {
          userId: context.userId,
          amountMicros,
          transactionType: CreditTransactionType.CREDIT_REFUND,
          description,
          referenceType: "refund",
          referenceId,
        },
      });

      return updated;
    });
  }

  async listTransactions(context: TenantContext, options?: { limit?: number; offset?: number }) {
    return this.prisma.creditTransaction.findMany({
      where: { userId: context.userId },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
  }

  async listUsageEvents(
    context: TenantContext,
    options?: { meetingId?: string; limit?: number; offset?: number },
  ) {
    return this.prisma.usageEvent.findMany({
      where: {
        userId: context.userId,
        ...(options?.meetingId ? { meetingId: options.meetingId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      include: {
        meeting: {
          select: { id: true, title: true },
        },
      },
    });
  }

  async getUsageSummary(context: TenantContext) {
    const events = await this.prisma.usageEvent.findMany({
      where: { userId: context.userId },
    });

    let totalAudioMinutes = 0;
    let totalLlmTokens = 0;
    let totalCostMicros = 0n;

    for (const ev of events) {
      totalCostMicros += ev.costMicros;
      if (ev.operationType === "AUDIO_TRANSCRIPTION" && ev.unit === "minutes") {
        totalAudioMinutes += ev.quantity;
      } else if (ev.operationType === "LLM_ANALYSIS" || ev.operationType.startsWith("LLM_")) {
        totalLlmTokens += ev.quantity;
      }
    }

    return {
      totalEvents: events.length,
      totalAudioMinutes: Math.round(totalAudioMinutes * 100) / 100,
      totalLlmTokens: Math.round(totalLlmTokens),
      totalCostMicros,
      totalCostDollars: Number(totalCostMicros) / 1_000_000,
    };
  }
}
