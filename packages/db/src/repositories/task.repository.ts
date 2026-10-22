import type { PrismaClient, Task, TaskStatus, Prisma } from "@prisma/client";
import type { TenantContext } from "./base.js";
import { CrossTenantAccessViolationError } from "./base.js";

export class TaskRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    context: TenantContext,
    meetingId: string,
    data: Omit<Prisma.TaskCreateInput, "meeting">,
  ): Promise<Task> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { userId: true },
    });

    if (!meeting || meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(meetingId, context.userId, "Meeting");
    }

    return this.prisma.task.create({
      data: {
        ...data,
        meeting: { connect: { id: meetingId } },
      },
    });
  }

  async findById(context: TenantContext, taskId: string): Promise<Task | null> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { meeting: { select: { userId: true } } },
    });

    if (!task) {
      return null;
    }

    if (task.meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(taskId, context.userId, "Task");
    }

    return task;
  }

  async listByMeeting(context: TenantContext, meetingId: string): Promise<Task[]> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { userId: true },
    });

    if (!meeting || meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(meetingId, context.userId, "Meeting");
    }

    return this.prisma.task.findMany({
      where: { meetingId },
      orderBy: { createdAt: "asc" },
    });
  }

  async updateStatus(
    context: TenantContext,
    taskId: string,
    status: TaskStatus,
  ): Promise<Task> {
    await this.findById(context, taskId);

    return this.prisma.task.update({
      where: { id: taskId },
      data: { status },
    });
  }
}
