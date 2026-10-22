import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { API_PREFIX } from "@dawwen/shared";
import { loggerOptions } from "./logger.js";
import { healthRoutes } from "./routes/health.js";

export interface AppOptions {
  corsOrigins: string[];
  logLevel?: string;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(opts.logLevel ?? "info"),
    trustProxy: true, // behind the ALB
    bodyLimit: 1024 * 1024, // audio never goes through the API (direct S3 upload)
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: opts.corsOrigins,
    credentials: true,
  });

  // Invariant 6: every route lives under /api (the ALB only forwards /api/* to this service).
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
    },
    { prefix: API_PREFIX },
  );

  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send({ error: "not_found" });
  });

  return app;
}
