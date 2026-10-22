import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProposalRepository } from "@dawwen/db";
import { ProposalStatus } from "@dawwen/db";
import type { ProposalExecutor } from "../services/proposal-executor.js";

interface ProposalRoutesOptions {
  proposalRepository: ProposalRepository;
  proposalExecutor: ProposalExecutor;
}

export async function proposalRoutes(
  fastify: FastifyInstance,
  options: ProposalRoutesOptions,
): Promise<void> {
  const { proposalRepository, proposalExecutor } = options;

  // 1. List proposals (inbox)
  fastify.get(
    "/proposals",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const query = request.query as { status?: ProposalStatus; limit?: string };

      const proposals = await proposalRepository.list(
        { userId: user.id },
        {
          status: query.status,
          limit: query.limit ? parseInt(query.limit, 10) : 50,
        },
      );

      return reply.send({ proposals });
    },
  );

  // 2. Get proposal by id
  fastify.get(
    "/proposals/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      try {
        const proposal = await proposalRepository.findById({ userId: user.id }, id);
        if (!proposal) {
          return reply.status(404).send({ error: "Proposal not found", message: "Proposal not found" });
        }
        return reply.send({ proposal });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Access error";
        return reply.status(403).send({ error: message, message });
      }
    },
  );

  // 3. Approve proposal (transitions PENDING_APPROVAL -> APPROVED)
  fastify.post(
    "/proposals/:id/approve",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { execute } = request.query as { execute?: string };

      try {
        if (execute === "true") {
          const execution = await proposalExecutor.approveAndExecute({ userId: user.id }, id);
          const proposal = await proposalRepository.findById({ userId: user.id }, id);
          return reply.send({
            proposal: proposal || { id, status: ProposalStatus.EXECUTED },
            execution,
            status: ProposalStatus.EXECUTED,
            proposalId: id,
            details: execution.details,
          });
        }

        const proposal = await proposalRepository.approve({ userId: user.id }, id);
        return reply.send({ proposal });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to approve proposal";
        return reply.status(400).send({
          error: message,
          message,
        });
      }
    },
  );

  // 4. Execute proposal (transitions APPROVED -> EXECUTED, books on calendar)
  fastify.post(
    "/proposals/:id/execute",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      try {
        const execution = await proposalExecutor.approveAndExecute({ userId: user.id }, id);
        const proposal = await proposalRepository.findById({ userId: user.id }, id);
        return reply.send({
          proposal: proposal || { id, status: ProposalStatus.EXECUTED },
          execution,
          status: ProposalStatus.EXECUTED,
          proposalId: id,
          details: execution.details,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to execute proposal";
        return reply.status(400).send({
          error: message,
          message,
        });
      }
    },
  );

  // 4. Reject proposal
  const RejectSchema = z.object({
    reason: z.string().optional(),
  });

  fastify.post(
    "/proposals/:id/reject",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const parsed = RejectSchema.safeParse(request.body || {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      try {
        const updated = await proposalExecutor.rejectProposal(
          { userId: user.id },
          id,
          reason,
        );
        return reply.send(updated);
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to reject proposal",
        });
      }
    },
  );
}
