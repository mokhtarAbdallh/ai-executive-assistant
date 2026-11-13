import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AgentService } from "../services/agent.js";
import type { TenantContext, Role } from "@dawwen/db";

const ChatQuerySchema = z.object({
  query: z.string().trim().min(1).max(2000),
  meetingId: z.string().max(64).optional(),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(50)
    .optional(),
});

export const chatRoutes: FastifyPluginAsync<{
  agentService: AgentService;
}> = async (fastify, opts) => {
  const { agentService } = opts;

  fastify.post(
    "/chat",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const tenantContext: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };

      const parseResult = ChatQuerySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: "invalid_request",
          details: parseResult.error.flatten(),
        });
      }

      // Errors go to the global handler (404 for another user's meeting, generic 500).
      const response = await agentService.processQuery(tenantContext, parseResult.data);
      return reply.code(200).send(response);
    },
  );
};
