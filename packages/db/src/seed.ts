import { prisma } from "./client.js";
import { scryptSync, randomBytes } from "node:crypto";
import { CreditTransactionType, Role } from "@prisma/client";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function seedDemoUser() {
  const demoEmail = "demo@dawwen.ai";
  const passwordHash = hashPassword("DawwenDemo2026!");

  const user = await prisma.user.upsert({
    where: { email: demoEmail },
    create: {
      email: demoEmail,
      name: "دوّن ديمو (Dawwen Demo)",
      passwordHash,
      role: Role.OWNER,
      settings: {
        create: {
          language: "ar",
          timezone: "Africa/Cairo",
          audioRetentionDays: 7,
        },
      },
      creditLedger: {
        create: {
          balanceMicros: 10_000_000n, // $10.00 USD
          reservedMicros: 0n,
        },
      },
    },
    update: {},
  });

  // Record initial topup transaction if none exists
  const txCount = await prisma.creditTransaction.count({
    where: { userId: user.id },
  });

  if (txCount === 0) {
    await prisma.creditTransaction.create({
      data: {
        userId: user.id,
        amountMicros: 10_000_000n,
        transactionType: CreditTransactionType.CREDIT_TOPUP,
        description: "Initial demo credits",
        referenceType: "seed",
      },
    });
  }

  return user;
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  seedDemoUser()
    .then((u) => {
      // eslint-disable-next-line no-console
      console.log(`Demo user seeded successfully: ${u.email} (${u.id})`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Failed to seed demo user:", err);
      process.exit(1);
    });
}
