import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LocalAuthProvider } from "../auth/local.provider.js";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().optional(),
});

export async function authRoutes(
  fastify: FastifyInstance,
  options: { localAuthProvider: LocalAuthProvider },
) {
  const { localAuthProvider } = options;

  fastify.post("/auth/register", async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.format(),
      });
    }

    try {
      const { user, tokens } = await localAuthProvider.register(parsed.data);

      reply.setCookie("dawwen_refresh_token", tokens.refreshToken, {
        path: "/api/auth",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });

      return reply.status(201).send({
        user,
        accessToken: tokens.accessToken,
        expiresInSeconds: tokens.expiresInSeconds,
      });
    } catch (err: unknown) {
      return reply.status(400).send({
        error: "Registration failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  fastify.post("/auth/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.format(),
      });
    }

    try {
      const { user, tokens } = await localAuthProvider.login(parsed.data);

      reply.setCookie("dawwen_refresh_token", tokens.refreshToken, {
        path: "/api/auth",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.send({
        user,
        accessToken: tokens.accessToken,
        expiresInSeconds: tokens.expiresInSeconds,
      });
    } catch {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Invalid email or password",
      });
    }
  });

  fastify.post("/auth/refresh", async (request, reply) => {
    const parsed = RefreshSchema.safeParse(request.body);
    const refreshToken =
      parsed.data?.refreshToken || request.cookies.dawwen_refresh_token;

    if (!refreshToken) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Missing refresh token",
      });
    }

    try {
      const tokens = await localAuthProvider.refresh(refreshToken);

      reply.setCookie("dawwen_refresh_token", tokens.refreshToken, {
        path: "/api/auth",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.send({
        accessToken: tokens.accessToken,
        expiresInSeconds: tokens.expiresInSeconds,
      });
    } catch {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Invalid or expired refresh token",
      });
    }
  });

  fastify.get(
    "/auth/me",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      return reply.send({ user: request.user });
    },
  );

  fastify.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie("dawwen_refresh_token", { path: "/api/auth" });
    reply.clearCookie("dawwen_access_token", { path: "/" });
    return reply.send({ status: "logged_out" });
  });
}
