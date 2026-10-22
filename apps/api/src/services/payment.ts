import type { CreditRepository } from "@dawwen/db";

export interface TopupParams {
  userId: string;
  amountMicros: bigint;
  currency?: string;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TopupResult {
  transactionId: string;
  amountMicros: bigint;
  currency: string;
  newBalanceMicros: bigint;
  status: "completed" | "pending";
  reference?: string;
  timestamp: string;
}

export interface PaymentProvider {
  readonly name: string;
  topup(params: TopupParams): Promise<TopupResult>;
  verify(transactionId: string): Promise<{ status: "completed" | "pending" | "failed" }>;
}

export class ManualPaymentAdapter implements PaymentProvider {
  readonly name = "manual";

  constructor(private readonly creditRepository: CreditRepository) {}

  async topup(params: TopupParams): Promise<TopupResult> {
    const { userId, amountMicros, reference, description } = params;
    const desc =
      description ||
      (reference ? `Top-up via manual payment (ref: ${reference})` : "Manual credit top-up");

    const ledger = await this.creditRepository.addCredits(
      { userId },
      amountMicros,
      desc,
      reference,
    );

    const txId = `tx-topup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
      transactionId: txId,
      amountMicros,
      currency: params.currency || "USD",
      newBalanceMicros: ledger.balanceMicros,
      status: "completed",
      reference,
      timestamp: new Date().toISOString(),
    };
  }

  async verify(_transactionId: string): Promise<{ status: "completed" | "pending" | "failed" }> {
    return { status: "completed" };
  }
}
