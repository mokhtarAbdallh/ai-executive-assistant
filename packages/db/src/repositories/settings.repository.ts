import type { PrismaClient, UserSettings } from "@prisma/client";
import type { TenantContext } from "./base.js";

export class SettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getSettings(context: TenantContext): Promise<UserSettings> {
    return this.prisma.userSettings.upsert({
      where: { userId: context.userId },
      create: {
        userId: context.userId,
        language: "ar",
        timezone: "Africa/Cairo",
        audioRetentionDays: 7,
      },
      update: {},
    });
  }

  async updateSettings(
    context: TenantContext,
    updates: {
      language?: string;
      timezone?: string;
      audioRetentionDays?: number;
    },
  ): Promise<UserSettings> {
    return this.prisma.userSettings.upsert({
      where: { userId: context.userId },
      create: {
        userId: context.userId,
        language: updates.language ?? "ar",
        timezone: updates.timezone ?? "Africa/Cairo",
        audioRetentionDays: updates.audioRetentionDays ?? 7,
      },
      update: {
        ...(updates.language ? { language: updates.language } : {}),
        ...(updates.timezone ? { timezone: updates.timezone } : {}),
        ...(updates.audioRetentionDays !== undefined
          ? { audioRetentionDays: updates.audioRetentionDays }
          : {}),
      },
    });
  }
}
