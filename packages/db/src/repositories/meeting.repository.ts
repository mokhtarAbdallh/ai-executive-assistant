import type { PrismaClient, Meeting, MeetingStatus, Prisma } from "@prisma/client";
import type { TenantContext} from "./base.js";
import { CrossTenantAccessViolationError } from "./base.js";

export class MeetingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    context: TenantContext,
    data: Omit<Prisma.MeetingCreateInput, "user">,
  ): Promise<Meeting> {
    return this.prisma.meeting.create({
      data: {
        ...data,
        user: { connect: { id: context.userId } },
      },
    });
  }

  async findById(context: TenantContext, meetingId: string): Promise<Meeting | null> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
    });

    if (!meeting) {
      return null;
    }

    if (meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(meetingId, context.userId, "Meeting");
    }

    return meeting;
  }

  async list(
    context: TenantContext,
    filter?: { status?: MeetingStatus; limit?: number; offset?: number },
  ): Promise<Meeting[]> {
    return this.prisma.meeting.findMany({
      where: {
        userId: context.userId,
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: filter?.limit ?? 50,
      skip: filter?.offset ?? 0,
    });
  }

  async updateStatus(
    context: TenantContext,
    meetingId: string,
    status: MeetingStatus,
    failureReason?: string,
  ): Promise<Meeting> {
    // Assert tenant ownership first
    await this.findById(context, meetingId);

    return this.prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status,
        failureReason: failureReason ?? null,
      },
    });
  }

  async findWithDetails(context: TenantContext, meetingId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        participants: true,
        transcriptSegments: { orderBy: { startMs: "asc" } },
        analysis: true,
        agendaItems: { orderBy: { orderIndex: "asc" } },
        topics: { orderBy: { orderIndex: "asc" } },
        decisions: { orderBy: { createdAt: "asc" } },
        tasks: { orderBy: { createdAt: "asc" } },
        openQuestions: { orderBy: { createdAt: "asc" } },
        documents: true,
        proposals: { orderBy: { createdAt: "desc" } },
        editHistories: { orderBy: { createdAt: "desc" } },
        consents: true,
      },
    });

    if (!meeting) {
      return null;
    }

    if (meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(meetingId, context.userId, "Meeting");
    }

    return meeting;
  }

  async update(
    context: TenantContext,
    meetingId: string,
    data: Prisma.MeetingUpdateInput,
  ): Promise<Meeting> {
    await this.findById(context, meetingId);

    return this.prisma.meeting.update({
      where: { id: meetingId },
      data,
    });
  }

  async approveAll(context: TenantContext, meetingId: string): Promise<Meeting> {
    await this.findById(context, meetingId);

    await this.prisma.$transaction([
      this.prisma.task.updateMany({
        where: { meetingId },
        data: { approved: true },
      }),
      this.prisma.decision.updateMany({
        where: { meetingId },
        data: { approved: true },
      }),
      this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: "APPROVED" },
      }),
    ]);

    return (await this.findById(context, meetingId))!;
  }

  async delete(context: TenantContext, meetingId: string): Promise<Meeting> {
    // Assert tenant ownership first
    await this.findById(context, meetingId);

    return this.prisma.meeting.delete({
      where: { id: meetingId },
    });
  }
}
