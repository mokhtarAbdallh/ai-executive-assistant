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
}
