import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConsentRepository } from "@dawwen/db";

const CreateConsentSchema = z.object({
  meetingId: z.string().optional(),
  participantName: z.string().min(1),
  participantEmail: z.string().email().optional(),
  consentMethod: z.enum(["ui_checkbox", "verbal_confirmed", "email_optin"]).default("ui_checkbox"),
});

const ListConsentsQuerySchema = z.object({
  meetingId: z.string().optional(),
});

export async function consentRoutes(
  fastify: FastifyInstance,
  options: { consentRepository: ConsentRepository },
) {
  const { consentRepository } = options;

  fastify.post(
    "/consents",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = CreateConsentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.format(),
        });
      }

      const user = request.user!;
      const consent = await consentRepository.createConsent(
        { userId: user.id },
        {
          ...parsed.data,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        },
      );

      return reply.status(201).send({ consent });
    },
  );

  fastify.get(
    "/consents",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const query = ListConsentsQuerySchema.safeParse(request.query);
      const user = request.user!;

      const consents = await consentRepository.listConsents(
        { userId: user.id },
        query.success ? query.data.meetingId : undefined,
      );

      return reply.send({ consents });
    },
  );
}
