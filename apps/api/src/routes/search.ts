import type { FastifyPluginAsync } from "fastify";
import type { SearchService } from "../services/search.js";
import type { TenantContext, Role } from "@dawwen/db";

export const searchRoutes: FastifyPluginAsync<{
  searchService: SearchService;
}> = async (fastify, opts) => {
  const { searchService } = opts;

  fastify.get<{
    Querystring: { q?: string; meetingId?: string; limit?: string };
  }>(
    "/search",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const query = request.query.q;
      if (!query || !query.trim()) {
        return reply.code(200).send({ results: [] });
      }

      const user = request.user!;
      const tenantContext: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };

      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 10;
      const meetingId = request.query.meetingId;

      try {
        const results = await searchService.search(tenantContext, {
          query,
          meetingId,
          limit,
        });

        return reply.code(200).send({ results });
      } catch (err) {
        request.log.error(err, "Search failed");
        return reply.code(500).send({
          error: "search_failed",
          message: err instanceof Error ? err.message : "Search error",
        });
      }
    },
  );
};
