import { Prisma } from "@prisma/client";

/**
 * Atomic credit-ledger statements (ADR-022). Raw SQL lives in `*.sql.ts` files only.
 *
 * Prisma's `updateMany` cannot compare two columns, so "reserve only if
 * balance - reserved >= amount" must be a single conditional UPDATE: Postgres
 * row-locks the ledger, so concurrent reservations serialize and can never
 * overdraw the balance.
 */

type RawExecutor = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

/** Returns true when the hold was placed, false when available credit is insufficient. */
export async function reserveCreditsAtomic(
  db: RawExecutor,
  userId: string,
  amountMicros: bigint,
): Promise<boolean> {
  const updated = await db.$executeRaw(Prisma.sql`
    UPDATE credit_ledgers
       SET "reservedMicros" = "reservedMicros" + ${amountMicros},
           "updatedAt" = now()
     WHERE "userId" = ${userId}
       AND "balanceMicros" - "reservedMicros" >= ${amountMicros}
  `);
  return updated === 1;
}

export interface SettleRow {
  balanceMicros: bigint;
  reservedMicros: bigint;
  chargedMicros: bigint;
}

/**
 * Releases a hold of `holdMicros` and debits up to `actualMicros`, capped so the
 * balance never drops below the holds of OTHER in-flight operations (and never
 * below zero). Returns null when the user has no ledger.
 */
export async function settleCreditsAtomic(
  db: RawExecutor,
  userId: string,
  holdMicros: bigint,
  actualMicros: bigint,
): Promise<SettleRow | null> {
  const rows = await db.$queryRaw<SettleRow[]>(Prisma.sql`
    WITH cur AS (
      SELECT "userId",
             "balanceMicros" AS bal,
             GREATEST("reservedMicros" - ${holdMicros}, 0) AS res
        FROM credit_ledgers
       WHERE "userId" = ${userId}
       FOR UPDATE
    ), calc AS (
      SELECT "userId", res,
             LEAST(${actualMicros}::bigint, GREATEST(bal - res, 0)) AS charged
        FROM cur
    )
    UPDATE credit_ledgers AS l
       SET "reservedMicros" = calc.res,
           "balanceMicros" = l."balanceMicros" - calc.charged,
           "updatedAt" = now()
      FROM calc
     WHERE l."userId" = calc."userId"
    RETURNING l."balanceMicros" AS "balanceMicros",
              l."reservedMicros" AS "reservedMicros",
              calc.charged AS "chargedMicros"
  `);
  return rows[0] ?? null;
}
