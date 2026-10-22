import type { PrismaClient} from "@prisma/client";
import { CreditTransactionType } from "@prisma/client";
import type { TenantContext } from "./base.js";

export class InsufficientBalanceError extends Error {
  constructor(public readonly availableMicros: bigint, public readonly requestedMicros: bigint) {
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

  async reserveCredits(
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
          balanceMicros: 0n,
          reservedMicros: 0n,
        },
        update: {},
      });

      const available = ledger.balanceMicros - ledger.reservedMicros;
      if (available < amountMicros) {
        throw new InsufficientBalanceError(available, amountMicros);
      }

      const updated = await tx.creditLedger.update({
        where: { userId: context.userId },
        data: {
          reservedMicros: { increment: amountMicros },
        },
      });

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

      return updated;
    });
  }

  async settleCredits(
    context: TenantContext,
    reservedMicros: bigint,
    actualMicros: bigint,
    description: string,
    referenceId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.creditLedger.update({
        where: { userId: context.userId },
        data: {
          reservedMicros: { decrement: reservedMicros },
          balanceMicros: { decrement: actualMicros },
        },
      });

      await tx.creditTransaction.create({
        data: {
          userId: context.userId,
          amountMicros: -actualMicros,
          transactionType: CreditTransactionType.CREDIT_SETTLE,
          description,
          referenceType: "meeting_settle",
          referenceId,
        },
      });

      return updated;
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

  async listTransactions(
    context: TenantContext,
    options?: { limit?: number; offset?: number },
  ) {
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
      } else if (
        ev.operationType === "LLM_ANALYSIS" ||
        ev.operationType.startsWith("LLM_")
      ) {
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

