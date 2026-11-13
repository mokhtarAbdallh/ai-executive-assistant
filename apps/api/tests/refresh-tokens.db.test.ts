/**
 * Refresh-token rotation against real Postgres (ADR-023). Skipped unless
 * TEST_DATABASE_URL is set (CI provides one).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Role } from "@dawwen/db";
import { LocalAuthProvider } from "../src/auth/local.provider.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("refresh tokens (real Postgres)", () => {
  let prisma: PrismaClient;
  let auth: LocalAuthProvider;
  const userId = `usr-rt-${Date.now()}`;
  const user = { id: userId, email: `${userId}@test.local`, name: "RT", role: Role.OWNER };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    auth = new LocalAuthProvider(prisma, "test-secret-key-that-is-at-least-32-chars-long");
    await prisma.user.create({ data: { id: userId, email: user.email, name: user.name } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("rotates, survives two concurrent refreshes, and logout kills the token", async () => {
    const { refreshToken } = await auth.issueTokens(user);

    const [a, b] = await Promise.all([auth.refresh(refreshToken), auth.refresh(refreshToken)]);
    expect(a.refreshToken).not.toBe(b.refreshToken);

    await auth.revokeRefreshToken(a.refreshToken);
    await expect(auth.refresh(a.refreshToken)).rejects.toThrow(/revoked/);
    await expect(auth.refresh(b.refreshToken)).resolves.toBeDefined();
  });

  it("deleting the user removes their refresh tokens", async () => {
    const other = `usr-rt2-${Date.now()}`;
    await prisma.user.create({ data: { id: other, email: `${other}@test.local`, name: "x" } });
    await auth.issueTokens({ ...user, id: other, email: `${other}@test.local` });
    await prisma.user.delete({ where: { id: other } });
    expect(await prisma.refreshToken.count({ where: { userId: other } })).toBe(0);
  });
});
