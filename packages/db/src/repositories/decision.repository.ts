import type { PrismaClient, Decision, Prisma } from "@prisma/client";
import type { TenantContext} from "./base.js";
import { CrossTenantAccessViolationError } from "./base.js";

export class DecisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    context: TenantContext,
    meetingId: string,
    data: Omit<Prisma.DecisionCreateInput, "meeting">,
  ): Promise<Decision> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { userId: true },
    });

    if (!meeting || meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(meetingId, context.userId, "Meeting");
    }

    return this.prisma.decision.create({
      data: {
        ...data,
        meeting: { connect: { id: meetingId } },
      },
    });
  }

  async listByMeeting(context: TenantContext, meetingId: string): Promise<Decision[]> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { userId: true },
    });

    if (!meeting || meeting.userId !== context.userId) {
      throw new CrossTenantAccessViolationError(meetingId, context.userId, "Meeting");
    }

    return this.prisma.decision.findMany({
      where: { meetingId },
      orderBy: { createdAt: "asc" },
    });
  }
}
