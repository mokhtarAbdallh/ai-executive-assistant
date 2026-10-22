import type { FastifyPluginAsync } from "fastify";

/**
 * ALB target-group health check (`GET /api/health` → 200). This is a liveness check only: it must
 * not depend on the database, otherwise a DB blip would make ECS kill every api task.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: { status: { type: "string" }, uptimeSeconds: { type: "number" } },
            required: ["status"],
          },
        },
      },
    },
    async () => ({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }),
  );
};
