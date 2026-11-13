import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ProposalRepository } from "@dawwen/db";
import {
  ProposalStatus,
  ProposalNotFoundError,
  ProposalAlreadyClaimedError,
  InvalidProposalTransitionError,
  UnauthorizedProposalExecutionError,
  CrossTenantAccessViolationError,
} from "@dawwen/db";
import {
  type ProposalExecutor,
  ProposalNotApprovedError,
  ProposalExecutionFailedError,
  ProposalIncompleteError,
  ProposalChannelUnavailableError,
} from "../services/proposal-executor.js";

interface ProposalRoutesOptions {
  proposalRepository: ProposalRepository;
  proposalExecutor: ProposalExecutor;
}

const IdParamsSchema = z.object({ id: z.string().min(1).max(64) });

const ListQuerySchema = z.object({
  status: z.nativeEnum(ProposalStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ApproveQuerySchema = z.object({
  execute: z.enum(["true", "false"]).optional(),
});

const RejectSchema = z.object({
  reason: z.string().max(1000).optional(),
});

/**
 * Maps proposal domain errors to HTTP codes. Another tenant's proposal is reported
 * as 404 (never 403) so ids of other users cannot be probed.
 */
function sendProposalError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ProposalNotFoundError || err instanceof CrossTenantAccessViolationError) {
    return reply.status(404).send({ error: "not_found", message: "Proposal not found" });
  }
  if (
    err instanceof ProposalAlreadyClaimedError ||
    err instanceof ProposalNotApprovedError ||
    err instanceof InvalidProposalTransitionError ||
    err instanceof UnauthorizedProposalExecutionError
  ) {
    return reply.status(409).send({ error: "conflict", message: err.message });
  }
  if (err instanceof ProposalIncompleteError) {
    return reply
      .status(422)
      .send({ error: "proposal_incomplete", message: err.message, missing: err.missing });
  }
  if (err instanceof ProposalChannelUnavailableError) {
    return reply.status(422).send({
      error: err.channel === "calendar" ? "calendar_not_connected" : "email_not_configured",
      message: err.message,
    });
  }
  if (err instanceof ProposalExecutionFailedError) {
    return reply.status(502).send({ error: "execution_failed", message: err.reason });
  }
  throw err;
}

export async function proposalRoutes(
  fastify: FastifyInstance,
  options: ProposalRoutesOptions,
): Promise<void> {
  const { proposalRepository, proposalExecutor } = options;

  async function executeAndRespond(reply: FastifyReply, userId: string, id: string) {
    const execution = await proposalExecutor.approveAndExecute({ userId }, id);
    const proposal = await proposalRepository.findById({ userId }, id);
    return reply.send({
      proposal,
      execution,
      status: ProposalStatus.EXECUTED,
      proposalId: id,
      details: execution.details,
    });
  }

  // 1. List proposals (inbox)
  fastify.get("/proposals", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const query = ListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Validation failed", details: query.error.format() });
    }
    const proposals = await proposalRepository.list(
      { userId: request.user!.id },
      { status: query.data.status, limit: query.data.limit },
    );
    return reply.send({ proposals });
  });

  // 2. Get proposal by id
  fastify.get("/proposals/:id", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Validation failed" });
    try {
      const proposal = await proposalRepository.findById(
        { userId: request.user!.id },
        params.data.id,
      );
      if (!proposal) throw new ProposalNotFoundError(params.data.id);
      return reply.send({ proposal });
    } catch (err) {
      return sendProposalError(reply, err);
    }
  });

  // 3. Approve (and by default with ?execute=true, execute) a proposal
  fastify.post(
    "/proposals/:id/approve",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = IdParamsSchema.safeParse(request.params);
      const query = ApproveQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      const userId = request.user!.id;
      try {
        if (query.data.execute === "true") {
          return await executeAndRespond(reply, userId, params.data.id);
        }
        const proposal = await proposalRepository.approve({ userId }, params.data.id);
        return reply.send({ proposal });
      } catch (err) {
        return sendProposalError(reply, err);
      }
    },
  );

  // 4. Execute an approved proposal (APPROVED -> EXECUTING -> EXECUTED)
  fastify.post(
    "/proposals/:id/execute",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = IdParamsSchema.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: "Validation failed" });
      try {
        return await executeAndRespond(reply, request.user!.id, params.data.id);
      } catch (err) {
        return sendProposalError(reply, err);
      }
    },
  );

  // 5. Reject proposal
  fastify.post(
    "/proposals/:id/reject",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = IdParamsSchema.safeParse(request.params);
      const body = RejectSchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return reply.status(400).send({ error: "Validation failed" });
      }
      try {
        const updated = await proposalExecutor.rejectProposal(
          { userId: request.user!.id },
          params.data.id,
          body.data.reason,
        );
        return reply.send(updated);
      } catch (err) {
        return sendProposalError(reply, err);
      }
    },
  );
}
