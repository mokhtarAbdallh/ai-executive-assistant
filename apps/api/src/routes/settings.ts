import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SettingsRepository } from "@dawwen/db";

const UpdateSettingsSchema = z.object({
  language: z.enum(["ar", "en"]).optional(),
  timezone: z.string().min(1).optional(),
  audioRetentionDays: z.number().int().min(1).max(365).optional(),
});

export async function settingsRoutes(
  fastify: FastifyInstance,
  options: { settingsRepository: SettingsRepository },
) {
  const { settingsRepository } = options;

  fastify.get(
    "/settings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const settings = await settingsRepository.getSettings({ userId: user.id });
      return reply.send({ settings });
    },
  );

  fastify.put(
    "/settings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = UpdateSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.format(),
        });
      }

      const user = request.user!;
      const updated = await settingsRepository.updateSettings(
        { userId: user.id },
        parsed.data,
      );

      return reply.send({ settings: updated });
    },
  );
}
