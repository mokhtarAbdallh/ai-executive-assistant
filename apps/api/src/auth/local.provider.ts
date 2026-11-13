import { scryptSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { PrismaClient } from "@dawwen/db";
import { Role } from "@dawwen/db";
import type { AuthenticatedUser, AuthTokens, IAuthProvider } from "./types.js";

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Two tabs may refresh with the same cookie at the same moment. */
const REUSE_GRACE_MS = 30_000;

export class LocalAuthProvider implements IAuthProvider {
  public readonly providerName = "local" as const;
  private readonly secretKey: Uint8Array;

  constructor(
    private readonly prisma: PrismaClient,
    appSecret: string,
    private readonly tokenIssuer = "dawwen-api",
  ) {
    this.secretKey = new TextEncoder().encode(appSecret);
  }

  hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
  }

  verifyPassword(password: string, storedHash: string): boolean {
    const [salt, key] = storedHash.split(":");
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, "hex");
    const derivedKey = scryptSync(password, salt, 64);
    return timingSafeEqual(keyBuffer, derivedKey);
  }

  /** Short-lived access token only (no session is created). */
  async issueAccessToken(
    user: AuthenticatedUser,
  ): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const accessToken = await new SignJWT({
      email: user.email,
      name: user.name,
      role: user.role,
      type: "access",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer(this.tokenIssuer)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(this.secretKey);
    return { accessToken, expiresInSeconds: 900 };
  }

  /**
   * Access token + a refresh token that is recorded server-side (ADR-023), so it
   * can be rotated, revoked on logout and detected when reused.
   */
  async issueTokens(user: AuthenticatedUser, jti: string = randomUUID()): Promise<AuthTokens> {
    const access = await this.issueAccessToken(user);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await this.prisma.refreshToken.create({ data: { id: jti, userId: user.id, expiresAt } });

    const refreshToken = await new SignJWT({ email: user.email, type: "refresh" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setJti(jti)
      .setIssuer(this.tokenIssuer)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secretKey);

    return { ...access, refreshToken };
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey, {
        issuer: this.tokenIssuer,
      });

      if (payload.type !== "access" || !payload.sub || !payload.email) {
        throw new Error("Invalid token claims");
      }

      return {
        id: payload.sub,
        email: payload.email as string,
        name: (payload.name as string) || "",
        role: (payload.role as Role) || Role.OWNER,
      };
    } catch {
      throw new Error("Unauthorized: Invalid or expired access token");
    }
  }

  async verifyRefreshToken(
    token: string,
  ): Promise<{ userId: string; email: string; jti: string | undefined }> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey, {
        issuer: this.tokenIssuer,
      });

      if (payload.type !== "refresh" || !payload.sub || !payload.email) {
        throw new Error("Invalid refresh token claims");
      }

      return {
        userId: payload.sub,
        email: payload.email as string,
        jti: payload.jti,
      };
    } catch {
      throw new Error("Unauthorized: Invalid or expired refresh token");
    }
  }

  async register(data: {
    email: string;
    password: string;
    name: string;
    role?: Role;
  }): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    const normalizedEmail = data.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw new Error("User with this email already exists.");
    }

    const passwordHash = this.hashPassword(data.password);

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        name: data.name.trim(),
        passwordHash,
        role: data.role ?? Role.OWNER,
        settings: {
          create: {
            language: "ar",
            timezone: "Africa/Cairo",
            audioRetentionDays: 0,
          },
        },
        creditLedger: {
          create: {
            balanceMicros: 0n,
            reservedMicros: 0n,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    const tokens = await this.issueTokens(user);
    return { user, tokens };
  }

  async login(data: {
    email: string;
    password: string;
  }): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    const normalizedEmail = data.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.passwordHash) {
      throw new Error("Invalid email or password.");
    }

    const isMatch = this.verifyPassword(data.password, user.passwordHash);
    if (!isMatch) {
      throw new Error("Invalid email or password.");
    }

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const tokens = await this.issueTokens(authenticatedUser);
    return { user: authenticatedUser, tokens };
  }

  /**
   * Rotates a refresh token: the presented one is revoked and a new pair issued.
   * Presenting an already-revoked token (outside a short grace window for two
   * tabs refreshing at once) means it was copied, so every session of that user
   * is revoked.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const claims = await this.verifyRefreshToken(refreshToken);
    if (!claims.jti) throw new Error("Unauthorized: refresh token has no id");

    const now = new Date();
    const nextJti = randomUUID();
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: claims.jti, userId: claims.userId, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, replacedBy: nextJti },
    });
    if (rotated.count === 0 && !(await this.isConcurrentRotation(claims.jti, now))) {
      const record = await this.prisma.refreshToken.findUnique({ where: { id: claims.jti } });
      // A rotated token presented again (outside the grace window) was copied.
      if (record?.replacedBy) await this.revokeAllSessions(claims.userId);
      throw new Error("Unauthorized: refresh token revoked");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: claims.userId },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) throw new Error("User not found.");
    return this.issueTokens(user, nextJti);
  }

  /**
   * True when the token was rotated moments ago and its successor is still live:
   * another tab refreshed with the same cookie. Logout / revoke-all never qualify.
   */
  private async isConcurrentRotation(jti: string, now: Date): Promise<boolean> {
    const record = await this.prisma.refreshToken.findUnique({ where: { id: jti } });
    if (!record?.revokedAt || !record.replacedBy) return false;
    if (now.getTime() - record.revokedAt.getTime() > REUSE_GRACE_MS) return false;
    const successor = await this.prisma.refreshToken.findUnique({
      where: { id: record.replacedBy },
    });
    // The successor may not be written yet when both requests arrive together.
    return !successor || !successor.revokedAt || Boolean(successor.replacedBy);
  }

  /** Logout: revokes the given refresh token. Never throws (logout must always succeed). */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
      const claims = await this.verifyRefreshToken(refreshToken);
      if (!claims.jti) return;
      await this.prisma.refreshToken.updateMany({
        where: { id: claims.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Invalid/expired token: nothing to revoke.
    }
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
