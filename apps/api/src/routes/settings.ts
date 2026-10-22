import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SettingsRepository } from "@dawwen/db";
import type { DataManagementService } from "../services/data-management.js";

const UpdateSettingsSchema = z.object({
  language: z.enum(["ar", "en"]).optional(),
  timezone: z.string().min(1).optional(),
  audioRetentionDays: z.number().int().min(0).max(365).optional(),
});

export interface SettingsRoutesOptions {
  settingsRepository: SettingsRepository;
  dataManagementService?: DataManagementService;
}

export async function settingsRoutes(
  fastify: FastifyInstance,
  options: SettingsRoutesOptions,
) {
  const { settingsRepository, dataManagementService } = options;

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

  // GET /api/settings/export — Export all user data as JSON
  fastify.get(
    "/settings/export",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      if (!dataManagementService) {
        return reply.status(501).send({ error: "Data management service not available" });
      }

      const user = request.user!;
      const exportData = await dataManagementService.exportAccountData({ userId: user.id });

      reply.header(
        "Content-Disposition",
        `attachment; filename="dawwen-export-${user.id}-${Date.now()}.json"`,
      );
      return reply.send(exportData);
    },
  );

  // DELETE /api/settings/account — Real account deletion
  fastify.delete(
    "/settings/account",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      if (!dataManagementService) {
        return reply.status(501).send({ error: "Data management service not available" });
      }

      const user = request.user!;
      const result = await dataManagementService.deleteAccount({ userId: user.id });

      return reply.send({
        success: true,
        message: "Account and all associated meetings, recordings, and data permanently deleted.",
        details: result,
      });
    },
  );
}
