import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthenticatedUser, IAuthProvider } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

export function createAuthMiddleware(authProvider: IAuthProvider) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const authHeader = request.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    } else if (request.cookies && request.cookies.dawwen_access_token) {
      token = request.cookies.dawwen_access_token;
    }

    if (!token) {
      reply.status(401).send({
        error: "Unauthorized",
        message: "Authentication required. Please provide a Bearer token or login.",
      });
      return;
    }

    try {
      const user = await authProvider.verifyAccessToken(token);
      request.user = user;
    } catch {
      reply.status(401).send({
        error: "Unauthorized",
        message: "Invalid or expired token.",
      });
    }
  };
}
