/**
 * Grants (or revokes) platform-admin rights — the only way to create the first admin
 * (ADR-022). Admins can credit users' ledgers via POST /api/billing/topup.
 *
 *   pnpm --filter @dawwen/db admin:grant ops@example.com
 *   pnpm --filter @dawwen/db admin:grant ops@example.com --revoke
 *
 * Uses DATABASE_URL from the environment. Runs on Node's built-in TypeScript
 * type stripping (no extra tooling).
 */
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = args
    .find((a) => !a.startsWith("--"))
    ?.trim()
    .toLowerCase();
  const revoke = args.includes("--revoke");

  if (!email) {
    console.error("Usage: admin:grant <email> [--revoke]");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.update({
      where: { email },
      data: { isPlatformAdmin: !revoke },
      select: { email: true, isPlatformAdmin: true },
    });
    console.log(`${user.email}: isPlatformAdmin=${String(user.isPlatformAdmin)}`);
  } catch {
    console.error(`No user with email ${email}. Register the account first.`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
