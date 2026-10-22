import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CreditRepository } from "@dawwen/db";
import type { PaymentProvider } from "../services/payment.js";

const TopupBodySchema = z.object({
  amountMicros: z.union([z.number(), z.string()]).optional(),
  amountDollars: z.number().positive().optional(),
  reference: z.string().max(255).optional(),
  description: z.string().max(255).optional(),
}).refine(
  (data) => data.amountMicros !== undefined || data.amountDollars !== undefined,
  { message: "Either amountMicros or amountDollars must be provided." },
);

export interface BillingRoutesOptions {
  creditRepository: CreditRepository;
  paymentProvider: PaymentProvider;
}

export async function billingRoutes(
  fastify: FastifyInstance,
  options: BillingRoutesOptions,
) {
  const { creditRepository, paymentProvider } = options;

  // 1. GET /api/billing/balance
  fastify.get(
    "/billing/balance",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const balance = await creditRepository.getBalance({ userId: user.id });

      const dollars = Number(balance.availableMicros) / 1_000_000;
      return reply.send({
        balanceMicros: balance.balanceMicros.toString(),
        reservedMicros: balance.reservedMicros.toString(),
        availableMicros: balance.availableMicros.toString(),
        currency: "USD",
        formattedBalance: `$${dollars.toFixed(2)}`,
      });
    },
  );

  // 2. GET /api/billing/transactions
  fastify.get(
    "/billing/transactions",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const query = request.query as { limit?: string; offset?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;

      const transactions = await creditRepository.listTransactions(
        { userId: user.id },
        { limit, offset },
      );

      return reply.send({
        transactions: transactions.map((t) => ({
          ...t,
          amountMicros: t.amountMicros.toString(),
          amountDollars: Number(t.amountMicros) / 1_000_000,
        })),
      });
    },
  );

  // 3. GET /api/billing/usage
  fastify.get(
    "/billing/usage",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const query = request.query as { meetingId?: string; limit?: string; offset?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;

      const [summary, events] = await Promise.all([
        creditRepository.getUsageSummary({ userId: user.id }),
        creditRepository.listUsageEvents(
          { userId: user.id },
          { meetingId: query.meetingId, limit, offset },
        ),
      ]);

      return reply.send({
        summary: {
          ...summary,
          totalCostMicros: summary.totalCostMicros.toString(),
        },
        events: events.map((ev) => ({
          ...ev,
          costMicros: ev.costMicros.toString(),
          costDollars: Number(ev.costMicros) / 1_000_000,
        })),
      });
    },
  );

  // 4. POST /api/billing/topup
  fastify.post(
    "/billing/topup",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = TopupBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.format(),
        });
      }

      const user = request.user!;
      let amountMicros: bigint;

      if (parsed.data.amountDollars !== undefined) {
        amountMicros = BigInt(Math.round(parsed.data.amountDollars * 1_000_000));
      } else {
        amountMicros = BigInt(parsed.data.amountMicros!);
      }

      if (amountMicros <= 0n) {
        return reply.status(400).send({
          error: "Invalid amount",
          message: "Top-up amount must be positive.",
        });
      }

      const result = await paymentProvider.topup({
        userId: user.id,
        amountMicros,
        reference: parsed.data.reference,
        description: parsed.data.description,
      });

      return reply.send({
        success: true,
        transaction: {
          ...result,
          amountMicros: result.amountMicros.toString(),
          newBalanceMicros: result.newBalanceMicros.toString(),
          formattedNewBalance: `$${(Number(result.newBalanceMicros) / 1_000_000).toFixed(2)}`,
        },
      });
    },
  );
}
