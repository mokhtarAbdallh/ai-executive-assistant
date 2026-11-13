import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError, type ZodType, type z } from "zod";
import { CrossTenantAccessViolationError, Prisma } from "@dawwen/db";

/**
 * Parses untrusted input (query string, params) with Zod. A failure throws the
 * ZodError, which the global error handler turns into a 400 (ADR-024).
 */
export function parseInput<S extends ZodType>(schema: S, input: unknown): z.infer<S> {
  return schema.parse(input);
}

/** Prisma errors that mean "this row does not exist (for you)". */
const NOT_FOUND_PRISMA_CODES = new Set([
  "P2025", // record to update/delete not found
  "P2023", // malformed id (e.g. not a uuid)
]);

/**
 * One place that maps errors to HTTP responses (ADR-024):
 * - another tenant's data → 404, never 500 and never "forbidden" (do not reveal it exists);
 * - invalid input (Zod) → 400 with the issues;
 * - client errors raised by Fastify (bad JSON, too large, …) keep their status;
 * - everything else → 500 with a generic body (no internals leak to the client).
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof CrossTenantAccessViolationError) {
      request.log.warn({ route: request.routeOptions.url }, "cross-tenant access refused");
      return reply.code(404).send({ error: "not_found" });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", details: error.format() });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      NOT_FOUND_PRISMA_CODES.has(error.code)
    ) {
      return reply.code(404).send({ error: "not_found" });
    }

    const statusCode = "statusCode" in error ? error.statusCode : undefined;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      const code = "code" in error && typeof error.code === "string" ? error.code : "bad_request";
      return reply.code(statusCode).send({ error: code, message: error.message });
    }

    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: "internal_error" });
  });
}
