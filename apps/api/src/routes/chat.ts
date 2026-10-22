import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AgentService } from "../services/agent.js";
import type { TenantContext, Role } from "@dawwen/db";

const ChatQuerySchema = z.object({
  query: z.string().min(1),
  meetingId: z.string().optional(),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
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

      try {
        const response = await agentService.processQuery(
          tenantContext,
          parseResult.data,
        );
        return reply.code(200).send(response);
      } catch (err) {
        request.log.error(err, "Agent query failed");
        return reply.code(500).send({
          error: "agent_error",
          message: err instanceof Error ? err.message : "Internal chat error",
        });
      }
    },
  );
};
