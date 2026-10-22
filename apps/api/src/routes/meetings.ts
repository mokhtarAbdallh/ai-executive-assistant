import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient, MeetingRepository, TaskRepository, DecisionRepository, Prisma } from "@dawwen/db";
import { MeetingStatus, Priority } from "@dawwen/db";
import { FakeSpeechToText } from "@dawwen/asr";
import { FakeLlmClient } from "@dawwen/llm";
import type { DataManagementService } from "../services/data-management.js";

const CreateMeetingSchema = z.object({
  title: z.string().trim().min(1).max(255),
  language: z.enum(["ar", "en", "mixed"]).default("ar"),
  scheduledStart: z.string().datetime().optional(),
});

const UpdateMeetingSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  language: z.enum(["ar", "en", "mixed"]).optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).optional(),
  ownerName: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  approved: z.boolean().optional(),
  needsReview: z.boolean().optional(),
});

const UpdateDecisionSchema = z.object({
  text: z.string().trim().min(1).optional(),
  approved: z.boolean().optional(),
  needsReview: z.boolean().optional(),
});

export interface MeetingsRoutesOptions {
  meetingRepository: MeetingRepository;
  taskRepository: TaskRepository;
  decisionRepository: DecisionRepository;
  prisma: PrismaClient;
  dataManagementService?: DataManagementService;
}

export async function meetingsRoutes(
  fastify: FastifyInstance,
  options: MeetingsRoutesOptions,
) {
  const { meetingRepository, prisma } = options;

  // 1. List meetings
  fastify.get(
    "/meetings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const query = request.query as { status?: MeetingStatus; search?: string };

      const where: Prisma.MeetingWhereInput = { userId: user.id };
      if (query.status) {
        where.status = query.status;
      }
      if (query.search) {
        where.title = { contains: query.search, mode: "insensitive" };
      }

      const meetings = await prisma.meeting.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              tasks: true,
              decisions: true,
              transcriptSegments: true,
            },
          },
        },
      });

      return reply.send(meetings);
    },
  );

  // 2. Create meeting
  fastify.post(
    "/meetings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = CreateMeetingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.format(),
        });
      }

      const user = request.user!;
      const meeting = await meetingRepository.create(
        { userId: user.id },
        {
          title: parsed.data.title,
          language: parsed.data.language,
          scheduledStart: parsed.data.scheduledStart
            ? new Date(parsed.data.scheduledStart)
            : new Date(),
          status: MeetingStatus.UPLOADED,
        },
      );

      return reply.status(201).send(meeting);
    },
  );

  // 3. Get meeting details
  fastify.get(
    "/meetings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user!;

      const meeting = await meetingRepository.findWithDetails({ userId: user.id }, id);
      if (!meeting) {
        return reply.status(404).send({ error: "Meeting not found" });
      }

      return reply.send(meeting);
    },
  );

  // 4. Update meeting
  fastify.patch(
    "/meetings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user!;

      const parsed = UpdateMeetingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.format(),
        });
      }

      const updated = await meetingRepository.update(
        { userId: user.id },
        id,
        parsed.data,
      );

      return reply.send(updated);
    },
  );

  // 5. Delete meeting (Real data deletion: DB rows, embeddings, and S3 audio)
  fastify.delete(
    "/meetings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user!;

      if (!id) {
        return reply.status(400).send({ error: "Missing meeting id" });
      }

      if (options.dataManagementService) {
        const result = await options.dataManagementService.deleteMeeting(
          { userId: user.id },
          id,
        );
        return reply.send(result);
      } else {
        await meetingRepository.delete({ userId: user.id }, id);
        return reply.send({ success: true, deletedMeetingId: id, audioDeletedFromS3: false });
      }
    },
  );

  // 6. Update task (action item)
  fastify.patch(
    "/meetings/:id/tasks/:taskId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id: meetingId, taskId } = request.params as { id: string; taskId: string };
      const user = request.user!;

      // Verify meeting ownership
      await meetingRepository.findById({ userId: user.id }, meetingId);

      const parsed = UpdateTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.format(),
        });
      }

      const existingTask = await prisma.task.findUnique({
        where: { id: taskId },
      });
      if (!existingTask || existingTask.meetingId !== meetingId) {
        return reply.status(404).send({ error: "Task not found" });
      }

      // Record edit history
      await prisma.editHistory.create({
        data: {
          meetingId,
          userId: user.id,
          entityType: "Task",
          entityId: taskId,
          originalValue: existingTask as unknown as Prisma.InputJsonValue,
          editedValue: parsed.data as unknown as Prisma.InputJsonValue,
        },
      });

      const updated = await prisma.task.update({
        where: { id: taskId },
        data: {
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.ownerName !== undefined ? { ownerName: parsed.data.ownerName } : {}),
          ...(parsed.data.dueDate !== undefined
            ? { dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null }
            : {}),
          ...(parsed.data.priority ? { priority: parsed.data.priority as Priority } : {}),
          ...(parsed.data.approved !== undefined ? { approved: parsed.data.approved } : {}),
          ...(parsed.data.needsReview !== undefined ? { needsReview: parsed.data.needsReview } : {}),
        },
      });

      return reply.send(updated);
    },
  );

  // 7. Update decision
  fastify.patch(
    "/meetings/:id/decisions/:decisionId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id: meetingId, decisionId } = request.params as {
        id: string;
        decisionId: string;
      };
      const user = request.user!;

      // Verify meeting ownership
      await meetingRepository.findById({ userId: user.id }, meetingId);

      const parsed = UpdateDecisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          details: parsed.error.format(),
        });
      }

      const existingDecision = await prisma.decision.findUnique({
        where: { id: decisionId },
      });
      if (!existingDecision || existingDecision.meetingId !== meetingId) {
        return reply.status(404).send({ error: "Decision not found" });
      }

      // Record edit history
      await prisma.editHistory.create({
        data: {
          meetingId,
          userId: user.id,
          entityType: "Decision",
          entityId: decisionId,
          originalValue: existingDecision as unknown as Prisma.InputJsonValue,
          editedValue: parsed.data as unknown as Prisma.InputJsonValue,
        },
      });

      const updated = await prisma.decision.update({
        where: { id: decisionId },
        data: {
          ...(parsed.data.text !== undefined ? { text: parsed.data.text } : {}),
          ...(parsed.data.approved !== undefined ? { approved: parsed.data.approved } : {}),
          ...(parsed.data.needsReview !== undefined ? { needsReview: parsed.data.needsReview } : {}),
        },
      });

      return reply.send(updated);
    },
  );

  // 8. Approve all reviewed decisions and tasks
  fastify.post(
    "/meetings/:id/approve",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user!;

      const approved = await meetingRepository.approveAll({ userId: user.id }, id);
      return reply.send(approved);
    },
  );

  // 9. Offline Demo Trigger: immediate in-memory processing with Fake ASR & Fake LLM
  fastify.post(
    "/meetings/:id/process-demo",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id: meetingId } = request.params as { id: string };
      const user = request.user!;

      const meeting = await meetingRepository.findById({ userId: user.id }, meetingId);
      if (!meeting) {
        return reply.status(404).send({ error: "Meeting not found" });
      }

      // Ensure consent exists for demo run
      let consent = await prisma.recordingConsent.findFirst({
        where: { meetingId, userId: user.id },
      });
      if (!consent) {
        consent = await prisma.recordingConsent.create({
          data: {
            userId: user.id,
            meetingId,
            participantName: user.name || "Demo User",
            consentMethod: "demo_auto",
          },
        });
      }

      // ASR Transcription
      const asr = new FakeSpeechToText();
      const asrResult = await asr.transcribe(Buffer.from("demo-audio"));

      // Clean existing segments if any
      await prisma.transcriptSegment.deleteMany({ where: { meetingId } });

      const savedSegments = [];
      for (const seg of asrResult.segments) {
        const created = await prisma.transcriptSegment.create({
          data: {
            meetingId,
            speakerLabel: seg.speakerLabel,
            startMs: seg.startMs,
            endMs: seg.endMs,
            text: seg.text,
            confidence: seg.confidence ?? 0.95,
            language: asrResult.language,
          },
        });
        savedSegments.push(created);
      }

      // LLM Analysis
      const llm = new FakeLlmClient();
      const llmResult = await llm.analyzeMeeting({
        meetingTitle: meeting.title,
        scheduledStart: meeting.scheduledStart ?? new Date(),
        language: "ar",
        segments: savedSegments.map((s) => ({
          id: s.id,
          speakerLabel: s.speakerLabel || "Speaker",
          text: s.text,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
      });

      const analysis = llmResult.analysis;

      // Persist analysis
      await prisma.meetingAnalysis.upsert({
        where: { meetingId },
        update: {
          tldr: analysis.tldr,
          purpose: analysis.purpose,
          rawJson: analysis as unknown as Prisma.InputJsonValue,
          modelName: llmResult.modelName,
          status: "ready",
        },
        create: {
          meetingId,
          tldr: analysis.tldr,
          purpose: analysis.purpose,
          rawJson: analysis as unknown as Prisma.InputJsonValue,
          modelName: llmResult.modelName,
          status: "ready",
        },
      });

      // Clear & create topics, decisions, tasks, open questions
      await prisma.topicDiscussion.deleteMany({ where: { meetingId } });
      await prisma.decision.deleteMany({ where: { meetingId } });
      await prisma.task.deleteMany({ where: { meetingId } });
      await prisma.agendaItem.deleteMany({ where: { meetingId } });
      await prisma.openQuestion.deleteMany({ where: { meetingId } });
      await prisma.proposal.deleteMany({ where: { meetingId } });

      for (let i = 0; i < analysis.agenda.length; i++) {
        await prisma.agendaItem.create({
          data: { meetingId, title: analysis.agenda[i]!, orderIndex: i },
        });
      }

      for (let i = 0; i < analysis.topics.length; i++) {
        const t = analysis.topics[i]!;
        await prisma.topicDiscussion.create({
          data: {
            meetingId,
            title: t.title,
            summary: t.summary,
            sourceTs: t.sourceTs,
            sourceSegmentIds: t.sourceSegmentIds,
            orderIndex: i,
          },
        });
      }

      for (const d of analysis.decisions) {
        await prisma.decision.create({
          data: {
            meetingId,
            text: d.text,
            sourceTs: d.sourceTs,
            sourceSegmentIds: d.sourceSegmentIds,
            needsReview: d.needsReview,
            approved: false,
          },
        });
      }

      for (const item of analysis.actionItems) {
        await prisma.task.create({
          data: {
            meetingId,
            title: item.task,
            ownerName: item.owner || null,
            dueDate: item.due ? new Date(item.due) : null,
            priority: item.priority ? (item.priority.toUpperCase() as Priority) : Priority.MEDIUM,
            sourceTs: item.sourceTs,
            sourceSegmentIds: item.sourceSegmentIds,
            needsReview: item.needsReview,
            approved: false,
          },
        });
      }

      for (const q of analysis.openQuestions) {
        await prisma.openQuestion.create({
          data: { meetingId, question: q },
        });
      }

      // Next meeting proposal (Invariant 1)
      if (analysis.nextMeeting) {
        await prisma.proposal.create({
          data: {
            userId: user.id,
            meetingId,
            actionType: "SCHEDULE_MEETING",
            payload: analysis.nextMeeting as unknown as Prisma.InputJsonValue,
            status: "PENDING_APPROVAL",
            reason: "Follow-up meeting proposed by AI",
          },
        });
      }

      // Update status to REVIEW_PENDING
      const finalMeeting = await prisma.meeting.update({
        where: { id: meetingId },
        data: {
          status: MeetingStatus.REVIEW_PENDING,
          audioDurationSeconds: asrResult.durationSeconds,
          actualEnd: new Date(),
        },
      });

      const fullDetails = await meetingRepository.findWithDetails(
        { userId: user.id },
        meetingId,
      );
      return reply.send(fullDetails || finalMeeting);
    },
  );
}



