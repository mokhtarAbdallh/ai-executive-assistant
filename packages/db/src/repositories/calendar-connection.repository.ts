import type { PrismaClient, CalendarConnection } from "@prisma/client";
import type { TenantContext } from "./base.js";
import { CrossTenantAccessViolationError } from "./base.js";

export class CalendarConnectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getConnection(
    context: TenantContext,
    provider: string = "google",
  ): Promise<CalendarConnection | null> {
    return this.prisma.calendarConnection.findFirst({
      where: {
        userId: context.userId,
        provider,
      },
    });
  }

  async upsertConnection(
    context: TenantContext,
    data: {
      provider?: string;
      encryptedTokens: string;
      calendarId?: string;
      syncStatus?: string;
    },
  ): Promise<CalendarConnection> {
    const provider = data.provider ?? "google";
    const existing = await this.getConnection(context, provider);

    if (existing) {
      if (existing.userId !== context.userId) {
        throw new CrossTenantAccessViolationError(existing.id, context.userId, "CalendarConnection");
      }
      return this.prisma.calendarConnection.update({
        where: { id: existing.id },
        data: {
          encryptedTokens: data.encryptedTokens,
          calendarId: data.calendarId ?? existing.calendarId,
          syncStatus: data.syncStatus ?? "active",
          updatedAt: new Date(),
        },
      });
    }

    return this.prisma.calendarConnection.create({
      data: {
        userId: context.userId,
        provider,
        encryptedTokens: data.encryptedTokens,
        calendarId: data.calendarId ?? "primary",
        syncStatus: data.syncStatus ?? "active",
      },
    });
  }

  async updateSyncStatus(
    context: TenantContext,
    connectionId: string,
    status: string,
    lastSyncedAt: Date = new Date(),
  ): Promise<CalendarConnection> {
    const existing = await this.prisma.calendarConnection.findUnique({
      where: { id: connectionId },
    });

    if (!existing) {
      throw new Error(`CalendarConnection '${connectionId}' not found.`);
    }

    if (existing.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(connectionId, context.userId, "CalendarConnection");
    }

    return this.prisma.calendarConnection.update({
      where: { id: connectionId },
      data: {
        syncStatus: status,
        lastSyncedAt,
      },
    });
  }

  async deleteConnection(
    context: TenantContext,
    provider: string = "google",
  ): Promise<void> {
    await this.prisma.calendarConnection.deleteMany({
      where: {
        userId: context.userId,
        provider,
      },
    });
  }
}
