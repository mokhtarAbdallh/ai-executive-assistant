import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { PrismaClient} from "@dawwen/db";
import { Role } from "@dawwen/db";
import type { AuthenticatedUser, AuthTokens, IAuthProvider } from "./types.js";

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

  async issueTokens(user: AuthenticatedUser): Promise<AuthTokens> {
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

    const refreshToken = await new SignJWT({
      email: user.email,
      type: "refresh",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer(this.tokenIssuer)
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(this.secretKey);

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: 900, // 15 mins
    };
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

  async verifyRefreshToken(token: string): Promise<{ userId: string; email: string }> {
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
            audioRetentionDays: 7,
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

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const claims = await this.verifyRefreshToken(refreshToken);
    const user = await this.prisma.user.findUnique({
      where: { id: claims.userId },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) {
      throw new Error("User not found.");
    }

    return this.issueTokens(user);
  }
}
