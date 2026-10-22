import type { PrismaClient, RecordingConsent } from "@prisma/client";
import type { TenantContext } from "./base.js";

export class ConsentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createConsent(
    context: TenantContext,
    data: {
      meetingId?: string;
      participantName: string;
      participantEmail?: string;
      consentMethod?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<RecordingConsent> {
    return this.prisma.recordingConsent.create({
      data: {
        userId: context.userId,
        meetingId: data.meetingId,
        participantName: data.participantName,
        participantEmail: data.participantEmail,
        consentMethod: data.consentMethod ?? "ui_checkbox",
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  }

  async listConsents(context: TenantContext, meetingId?: string): Promise<RecordingConsent[]> {
    return this.prisma.recordingConsent.findMany({
      where: {
        userId: context.userId,
        ...(meetingId ? { meetingId } : {}),
      },
      orderBy: { consentedAt: "desc" },
    });
  }

  async hasConsent(context: TenantContext, meetingId: string): Promise<boolean> {
    const count = await this.prisma.recordingConsent.count({
      where: {
        userId: context.userId,
        meetingId,
      },
    });
    return count > 0;
  }
}
