import { type S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { PrismaClient } from "@dawwen/db";
import {
  type MeetingRepository,
  type TenantContext,
  CrossTenantAccessViolationError,
} from "@dawwen/db";

export interface DataManagementOptions {
  prisma: PrismaClient;
  meetingRepository: MeetingRepository;
  s3Client?: S3Client;
  bucketName?: string;
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export class DataManagementService {
  private readonly prisma: PrismaClient;
  private readonly meetingRepository: MeetingRepository;
  private readonly s3Client?: S3Client;
  private readonly bucketName: string;
  private readonly log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };

  constructor(options: DataManagementOptions) {
    this.prisma = options.prisma;
    this.meetingRepository = options.meetingRepository;
    this.s3Client = options.s3Client;
    this.bucketName =
      options.bucketName ||
      process.env.AUDIO_BUCKET_NAME ||
      "meeting-assistant-audio";
    this.log = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  async deleteMeeting(
    context: TenantContext,
    meetingId: string,
  ): Promise<{ success: boolean; deletedMeetingId: string; audioDeletedFromS3: boolean }> {
    const meeting = await this.meetingRepository.findById(context, meetingId);
    if (!meeting) {
      throw new Error(`Meeting not found: ${meetingId}`);
    }

    let audioDeletedFromS3 = false;
    // 1. Delete raw audio from S3 if key exists and not already deleted
    if (meeting.audioS3Key && this.s3Client) {
      try {
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: meeting.audioS3Key,
          }),
        );
        audioDeletedFromS3 = true;
        this.log.info("Deleted audio object from S3", { s3Key: meeting.audioS3Key });
      } catch (err) {
        this.log.warn("Failed to delete audio from S3 during meeting deletion", {
          error: (err as Error).message,
          s3Key: meeting.audioS3Key,
        });
      }
    }

    // 2. Delete embeddings
    try {
      await this.prisma.meetingEmbedding.deleteMany({
        where: { meetingId },
      });
    } catch (err) {
      this.log.warn("Failed to delete meeting embeddings", {
        error: (err as Error).message,
        meetingId,
      });
    }

    // 3. Delete meeting from DB (cascading deletes handle related children)
    await this.meetingRepository.delete(context, meetingId);

    return {
      success: true,
      deletedMeetingId: meetingId,
      audioDeletedFromS3,
    };
  }

  async exportAccountData(context: TenantContext): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: context.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new CrossTenantAccessViolationError(context.userId, context.userId, "User");
    }

    const settings = await this.prisma.userSettings.findUnique({
      where: { userId: context.userId },
    });

    const meetings = await this.prisma.meeting.findMany({
      where: { userId: context.userId },
      include: {
        participants: true,
        transcriptSegments: { orderBy: { startMs: "asc" } },
        analysis: true,
        agendaItems: true,
        topics: true,
        decisions: true,
        tasks: true,
        openQuestions: true,
        documents: true,
        proposals: true,
        followUpDrafts: true,
        reminders: true,
        consents: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const creditLedger = await this.prisma.creditLedger.findUnique({
      where: { userId: context.userId },
    });

    const creditTransactions = await this.prisma.creditTransaction.findMany({
      where: { userId: context.userId },
      orderBy: { createdAt: "desc" },
    });

    const usageEvents = await this.prisma.usageEvent.findMany({
      where: { userId: context.userId },
      orderBy: { createdAt: "desc" },
    });

    return {
      metadata: {
        exportDate: new Date().toISOString(),
        version: "1.0",
        format: "dawwen-account-export",
      },
      user,
      settings,
      creditLedger: creditLedger
        ? {
            balanceMicros: creditLedger.balanceMicros.toString(),
            reservedMicros: creditLedger.reservedMicros.toString(),
            updatedAt: creditLedger.updatedAt,
          }
        : null,
      creditTransactions: creditTransactions.map((tx) => ({
        ...tx,
        amountMicros: tx.amountMicros.toString(),
      })),
      usageEvents: usageEvents.map((ev) => ({
        ...ev,
        costMicros: ev.costMicros.toString(),
      })),
      meetings,
    };
  }

  async deleteAccount(
    context: TenantContext,
  ): Promise<{ success: boolean; deletedUserId: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: context.userId },
      include: {
        meetings: {
          select: { id: true, audioS3Key: true },
        },
      },
    });

    if (!user) {
      throw new CrossTenantAccessViolationError(context.userId, context.userId, "User");
    }

    // 1. Delete S3 audio files for all user meetings
    if (this.s3Client) {
      for (const meeting of user.meetings) {
        if (meeting.audioS3Key) {
          try {
            await this.s3Client.send(
              new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: meeting.audioS3Key,
              }),
            );
          } catch (err) {
            this.log.warn("Failed to delete S3 audio during account deletion", {
              s3Key: meeting.audioS3Key,
              error: (err as Error).message,
            });
          }
        }
      }
    }

    // 2. Delete embeddings for user's meetings
    const meetingIds = user.meetings.map((m) => m.id);
    if (meetingIds.length > 0) {
      try {
        await this.prisma.meetingEmbedding.deleteMany({
          where: { meetingId: { in: meetingIds } },
        });
      } catch (err) {
        this.log.warn("Failed to delete embeddings during account deletion", {
          error: (err as Error).message,
        });
      }
    }

    // 3. Delete user row (cascades all related entities: meetings, settings, consents, proposals, ledger, transactions, reminders, etc.)
    await this.prisma.user.delete({
      where: { id: context.userId },
    });

    return {
      success: true,
      deletedUserId: context.userId,
    };
  }
}
