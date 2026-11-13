import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CreditRepository, PrismaClient } from "@dawwen/db";
import type { PaymentProvider } from "../services/payment.js";
import { parseInput } from "../errors.js";

const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const UsageQuerySchema = PageQuerySchema.extend({
  meetingId: z.string().uuid().optional(),
});

/** Max single top-up: $100,000 — guards against fat-finger admin input. */
const MAX_TOPUP_MICROS = 100_000n * 1_000_000n;

const TopupBodySchema = z
  .object({
    /** The user whose ledger is credited (admins only, ADR-022). */
    userEmail: z.string().trim().toLowerCase().email(),
    /** Integer micros as a decimal string (no floats, no sign). */
    amountMicros: z
      .string()
      .regex(/^[0-9]{1,15}$/, "amountMicros must be a positive integer string")
      .optional(),
    amountDollars: z.number().positive().max(100_000).optional(),
    reference: z.string().max(255).optional(),
    description: z.string().max(255).optional(),
  })
  .refine((data) => (data.amountMicros === undefined) !== (data.amountDollars === undefined), {
    message: "Provide exactly one of amountMicros or amountDollars.",
  });

export interface BillingRoutesOptions {
  creditRepository: CreditRepository;
  paymentProvider: PaymentProvider;
  prisma: PrismaClient;
}

export async function billingRoutes(fastify: FastifyInstance, options: BillingRoutesOptions) {
  const { creditRepository, paymentProvider, prisma } = options;

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
      const { limit, offset } = parseInput(PageQuerySchema, request.query);

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
  fastify.get("/billing/usage", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user!;
    const query = parseInput(UsageQuerySchema, request.query);
    const { limit, offset } = query;

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
  });

  // 4. POST /api/billing/topup — platform admins only (ADR-022).
  // Regular users cannot credit any ledger, including their own; payments are
  // confirmed out-of-band (InstaPay / transfer) and then credited by an admin.
  fastify.post("/billing/topup", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    // Re-read the flag on every call so a revoked admin's old token stops working.
    const caller = await prisma.user.findUnique({
      where: { id: request.user!.id },
      select: { isPlatformAdmin: true },
    });
    if (!caller?.isPlatformAdmin) {
      return reply.status(403).send({
        error: "forbidden",
        message: "Only a platform admin can add credit.",
      });
    }

    const parsed = TopupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.format(),
      });
    }

    const amountMicros =
      parsed.data.amountDollars !== undefined
        ? BigInt(Math.round(parsed.data.amountDollars * 1_000_000))
        : BigInt(parsed.data.amountMicros!);

    if (amountMicros <= 0n || amountMicros > MAX_TOPUP_MICROS) {
      return reply.status(400).send({
        error: "Invalid amount",
        message: "Top-up amount must be positive and at most $100,000.",
      });
    }

    const target = await prisma.user.findUnique({
      where: { email: parsed.data.userEmail },
      select: { id: true },
    });
    if (!target) {
      return reply.status(404).send({ error: "not_found", message: "User not found" });
    }

    const result = await paymentProvider.topup({
      userId: target.id,
      amountMicros,
      reference: parsed.data.reference,
      description:
        parsed.data.description ??
        `Manual top-up by admin ${request.user!.id}${parsed.data.reference ? ` (ref: ${parsed.data.reference})` : ""}`,
    });

    request.log.info(
      { adminId: request.user!.id, targetUserId: target.id, amountMicros: amountMicros.toString() },
      "admin credit top-up",
    );

    return reply.send({
      success: true,
      transaction: {
        ...result,
        amountMicros: result.amountMicros.toString(),
        newBalanceMicros: result.newBalanceMicros.toString(),
        formattedNewBalance: `$${(Number(result.newBalanceMicros) / 1_000_000).toFixed(2)}`,
      },
    });
  });
}
