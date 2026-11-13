import type { FastifyPluginAsync } from "fastify";
import type { SearchService } from "../services/search.js";
import type { TenantContext, Role } from "@dawwen/db";
import { z } from "zod";
import { parseInput } from "../errors.js";

const SearchQuerySchema = z.object({
  q: z.string().max(500).optional(),
  meetingId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const searchRoutes: FastifyPluginAsync<{
  searchService: SearchService;
}> = async (fastify, opts) => {
  const { searchService } = opts;

  fastify.get(
    "/search",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const { q: query, meetingId, limit } = parseInput(SearchQuerySchema, request.query);
      if (!query || !query.trim()) {
        return reply.code(200).send({ results: [] });
      }

      const user = request.user!;
      const tenantContext: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };

      try {
        const results = await searchService.search(tenantContext, {
          query,
          meetingId,
          limit,
        });

        return reply.code(200).send({ results });
      } catch (err) {
        request.log.error({ err }, "Search failed");
        return reply.code(500).send({ error: "search_failed" });
      }
    },
  );
};
