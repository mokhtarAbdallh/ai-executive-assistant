import type { PrismaClient, FollowUpDraft } from "@prisma/client";
import type { TenantContext } from "./base.js";
import { CrossTenantAccessViolationError } from "./base.js";

export interface CreateDraftInput {
  meetingId: string;
  recipientEmail?: string | null;
  recipientName?: string | null;
  channel?: string;
  subject?: string | null;
  body: string;
  status?: string;
}

export class FollowUpDraftRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(context: TenantContext, input: CreateDraftInput): Promise<FollowUpDraft> {
    // Verify meeting belongs to tenant
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: { userId: true },
    });

    if (!meeting || meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(input.meetingId, context.userId, "Meeting");
    }

    return this.prisma.followUpDraft.create({
      data: {
        meetingId: input.meetingId,
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName,
        channel: input.channel ?? "email",
        subject: input.subject,
        body: input.body,
        status: input.status ?? "draft",
      },
    });
  }

  async findById(context: TenantContext, draftId: string): Promise<FollowUpDraft | null> {
    const draft = await this.prisma.followUpDraft.findUnique({
      where: { id: draftId },
      include: {
        meeting: {
          select: { userId: true },
        },
      },
    });

    if (!draft) {
      return null;
    }

    if (draft.meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(draftId, context.userId, "FollowUpDraft");
    }

    return draft;
  }

  async listByMeeting(context: TenantContext, meetingId: string): Promise<FollowUpDraft[]> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { userId: true },
    });

    if (!meeting || meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(meetingId, context.userId, "Meeting");
    }

    return this.prisma.followUpDraft.findMany({
      where: { meetingId },
      orderBy: { createdAt: "desc" },
    });
  }

  async listByUser(context: TenantContext, limit = 50): Promise<FollowUpDraft[]> {
    return this.prisma.followUpDraft.findMany({
      where: {
        meeting: {
          userId: context.userId,
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        meeting: {
          select: { id: true, title: true },
        },
      },
    });
  }

  async update(
    context: TenantContext,
    draftId: string,
    updates: Partial<Pick<FollowUpDraft, "subject" | "body" | "recipientName" | "recipientEmail" | "channel" | "status" | "sentAt">>,
  ): Promise<FollowUpDraft> {
    const existing = await this.findById(context, draftId);
    if (!existing) {
      throw new Error(`FollowUpDraft '${draftId}' not found.`);
    }

    return this.prisma.followUpDraft.update({
      where: { id: draftId },
      data: updates,
    });
  }

  async delete(context: TenantContext, draftId: string): Promise<void> {
    const existing = await this.findById(context, draftId);
    if (!existing) {
      throw new Error(`FollowUpDraft '${draftId}' not found.`);
    }

    await this.prisma.followUpDraft.delete({
      where: { id: draftId },
    });
  }
}
