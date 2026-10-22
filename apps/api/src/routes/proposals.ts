import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProposalRepository } from "@dawwen/db";

const ProposalActionParamsSchema = z.object({
  id: z.string().min(1),
});

const RejectBodySchema = z.object({
  reason: z.string().optional(),
});

export async function proposalRoutes(
  fastify: FastifyInstance,
  options: { proposalRepository: ProposalRepository },
) {
  const { proposalRepository } = options;

  fastify.get(
    "/proposals",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const proposals = await proposalRepository.list({ userId: user.id });
      return reply.send({ proposals });
    },
  );

  fastify.post(
    "/proposals/:id/approve",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = ProposalActionParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: "Invalid proposal ID" });
      }

      const user = request.user!;

      try {
        const approved = await proposalRepository.approve(
          { userId: user.id },
          params.data.id,
        );
        return reply.send({ proposal: approved });
      } catch (err: unknown) {
        return reply.status(400).send({
          error: "Failed to approve proposal",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  fastify.post(
    "/proposals/:id/reject",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = ProposalActionParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: "Invalid proposal ID" });
      }

      const body = RejectBodySchema.safeParse(request.body ?? {});
      const user = request.user!;

      try {
        const rejected = await proposalRepository.reject(
          { userId: user.id },
          params.data.id,
          body.success ? body.data.reason : undefined,
        );
        return reply.send({ proposal: rejected });
      } catch (err: unknown) {
        return reply.status(400).send({
          error: "Failed to reject proposal",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
