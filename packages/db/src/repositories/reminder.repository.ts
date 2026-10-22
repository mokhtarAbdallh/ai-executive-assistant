import type { PrismaClient, Reminder } from "@prisma/client";
import { ReminderStatus } from "@prisma/client";
import type { TenantContext } from "./base.js";
import { CrossTenantAccessViolationError } from "./base.js";

export interface CreateReminderInput {
  taskId?: string | null;
  meetingId?: string | null;
  remindAt: Date;
  channel?: string;
  status?: ReminderStatus;
}

export class ReminderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(context: TenantContext, input: CreateReminderInput): Promise<Reminder> {
    // If meetingId is specified, check meeting belongs to tenant
    if (input.meetingId) {
      const meeting = await this.prisma.meeting.findUnique({
        where: { id: input.meetingId },
        select: { userId: true },
      });
      if (!meeting || meeting.userId !== context.userId) {
        throw new CrossTenantAccessViolationError(input.meetingId, context.userId, "Meeting");
      }
    }

    // If taskId is specified, check task belongs to tenant's meeting
    if (input.taskId) {
      const task = await this.prisma.task.findUnique({
        where: { id: input.taskId },
        include: { meeting: { select: { userId: true } } },
      });
      if (!task || task.meeting.userId !== context.userId) {
        throw new CrossTenantAccessViolationError(input.taskId, context.userId, "Task");
      }
    }

    return this.prisma.reminder.create({
      data: {
        userId: context.userId,
        meetingId: input.meetingId,
        taskId: input.taskId,
        remindAt: input.remindAt,
        channel: input.channel ?? "console",
        status: input.status ?? ReminderStatus.SCHEDULED,
      },
    });
  }

  async findById(context: TenantContext, reminderId: string): Promise<Reminder | null> {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id: reminderId },
      include: {
        task: true,
        meeting: { select: { id: true, title: true } },
      },
    });

    if (!reminder) {
      return null;
    }

    if (reminder.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(reminderId, context.userId, "Reminder");
    }

    return reminder;
  }

  async listByUser(
    context: TenantContext,
    filter?: { status?: ReminderStatus; limit?: number },
  ): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: {
        userId: context.userId,
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { remindAt: "asc" },
      take: filter?.limit ?? 50,
      include: {
        task: true,
        meeting: { select: { id: true, title: true } },
      },
    });
  }

  async listByMeeting(context: TenantContext, meetingId: string): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: {
        userId: context.userId,
        meetingId,
      },
      orderBy: { remindAt: "asc" },
      include: {
        task: true,
      },
    });
  }

  async updateStatus(
    context: TenantContext,
    reminderId: string,
    status: ReminderStatus,
    sentAt?: Date,
  ): Promise<Reminder> {
    const existing = await this.findById(context, reminderId);
    if (!existing) {
      throw new Error(`Reminder '${reminderId}' not found.`);
    }

    return this.prisma.reminder.update({
      where: { id: reminderId },
      data: {
        status,
        ...(sentAt ? { sentAt } : {}),
      },
    });
  }

  async cancel(context: TenantContext, reminderId: string): Promise<Reminder> {
    return this.updateStatus(context, reminderId, ReminderStatus.CANCELLED);
  }

  async delete(context: TenantContext, reminderId: string): Promise<void> {
    const existing = await this.findById(context, reminderId);
    if (!existing) {
      throw new Error(`Reminder '${reminderId}' not found.`);
    }

    await this.prisma.reminder.delete({
      where: { id: reminderId },
    });
  }
}
