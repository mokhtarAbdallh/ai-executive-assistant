import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { LocalAuthProvider } from "../src/auth/local.provider.js";
import { Role } from "@dawwen/db";
import type { PrismaClient } from "@dawwen/db";

interface RefreshRow {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy?: string | null;
}

function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  const cookie = list.find((c) => String(c).startsWith("dawwen_refresh_token="));
  return String(cookie).split(";")[0]!.split("=")[1]!;
}

describe("Auth API (/api/auth/*)", () => {
  let app: FastifyInstance;
  const refreshTokens = new Map<string, RefreshRow>();
  const mockUsers = new Map<
    string,
    {
      id: string;
      email: string;
      name: string;
      passwordHash: string;
      role: Role;
      createdAt: Date;
      updatedAt: Date;
    }
  >();

  const mockPrisma = {
    user: {
      findUnique: vi
        .fn()
        .mockImplementation(({ where }: { where: { email?: string; id?: string } }) => {
          if (where.email) {
            for (const u of mockUsers.values()) {
              if (u.email === where.email) return Promise.resolve(u);
            }
          }
          if (where.id) {
            return Promise.resolve(mockUsers.get(where.id) || null);
          }
          return Promise.resolve(null);
        }),
      create: vi
        .fn()
        .mockImplementation(
          ({
            data,
          }: {
            data: { email: string; name: string; passwordHash: string; role?: Role };
          }) => {
            const id = `user-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            const user = {
              id,
              email: data.email,
              name: data.name,
              passwordHash: data.passwordHash,
              role: data.role || Role.OWNER,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            mockUsers.set(id, user);
            return Promise.resolve(user);
          },
        ),
    },
    refreshToken: {
      create: vi.fn(async ({ data }: { data: RefreshRow }) => {
        refreshTokens.set(data.id, { ...data, revokedAt: null });
        return refreshTokens.get(data.id);
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => refreshTokens.get(where.id) ?? null,
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; userId?: string; revokedAt: null; expiresAt?: { gt: Date } };
          data: { revokedAt: Date; replacedBy?: string };
        }) => {
          let count = 0;
          for (const row of refreshTokens.values()) {
            if (where.id && row.id !== where.id) continue;
            if (where.userId && row.userId !== where.userId) continue;
            if (row.revokedAt) continue;
            if (where.expiresAt && !(row.expiresAt > where.expiresAt.gt)) continue;
            Object.assign(row, data);
            count++;
          }
          return { count };
        },
      ),
    },
  } as unknown as PrismaClient;

  const testSecret = "test-secret-key-that-is-at-least-32-chars-long";
  const localAuthProvider = new LocalAuthProvider(mockPrisma, testSecret);

  beforeAll(async () => {
    app = await buildApp({
      corsOrigins: ["http://localhost:5173"],
      logLevel: "silent",
      appSecret: testSecret,
      prisma: mockPrisma,
      localAuthProvider,
      authProvider: localAuthProvider,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/auth/register creates user and returns tokens", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "ahmed@example.com",
        password: "Password123!",
        name: "أحمد علي",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe("ahmed@example.com");
    expect(body.user.name).toBe("أحمد علي");
    expect(body.accessToken).toBeDefined();
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("POST /api/auth/register rejects duplicate email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "ahmed@example.com",
        password: "Password123!",
        name: "أحمد علي مكرر",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Registration failed");
  });

  it("POST /api/auth/login succeeds with correct password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "ahmed@example.com",
        password: "Password123!",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe("ahmed@example.com");
    expect(body.accessToken).toBeDefined();
  });

  it("POST /api/auth/login fails with incorrect password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "ahmed@example.com",
        password: "WrongPassword!",
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it("GET /api/auth/me returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });

    expect(res.statusCode).toBe(401);
  });

  it("GET /api/auth/me returns authenticated user with valid token", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "ahmed@example.com",
        password: "Password123!",
      },
    });

    const token = loginRes.json().accessToken;

    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().user.email).toBe("ahmed@example.com");
    // Admin flag comes from the DB, defaulting to false for regular users.
    expect(meRes.json().user.isPlatformAdmin).toBe(false);
  });

  describe("refresh token rotation & revocation (ADR-023)", () => {
    const login = () =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "ahmed@example.com", password: "Password123!" },
      });
    const refresh = (token: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        cookies: { dawwen_refresh_token: token },
      });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("rotates: a refresh returns a new refresh token", async () => {
      const first = refreshCookie(await login());
      const res = await refresh(first);

      expect(res.statusCode).toBe(200);
      expect(refreshCookie(res)).not.toBe(first);
    });

    it("logout revokes the refresh token on the server", async () => {
      const token = refreshCookie(await login());
      const out = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { dawwen_refresh_token: token },
      });
      expect(out.statusCode).toBe(200);

      expect((await refresh(token)).statusCode).toBe(401);
    });

    it("reusing a rotated token later revokes every session (stolen-token detection)", async () => {
      const stolen = refreshCookie(await login());
      const current = refreshCookie(await refresh(stolen));

      vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ["Date"] });
      expect((await refresh(stolen)).statusCode).toBe(401);
      expect((await refresh(current)).statusCode).toBe(401);
    });

    it("tolerates two tabs refreshing with the same token at the same moment", async () => {
      const token = refreshCookie(await login());
      const [a, b] = await Promise.all([refresh(token), refresh(token)]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    });
  });
});
