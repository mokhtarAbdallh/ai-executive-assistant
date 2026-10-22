import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type {
  FollowUpDraftRepository,
  ReminderRepository,
  ProposalRepository,
  TenantContext,
  Role,
} from "@dawwen/db";
import { ProposalActionType } from "@dawwen/db";

const CreateDraftSchema = z.object({
  meetingId: z.string(),
  recipientEmail: z.string().email().optional().nullable(),
  recipientName: z.string().optional().nullable(),
  channel: z.string().default("email"),
  subject: z.string().optional().nullable(),
  body: z.string().min(1),
});

const UpdateDraftSchema = z.object({
  subject: z.string().optional().nullable(),
  body: z.string().optional(),
  recipientName: z.string().optional().nullable(),
  recipientEmail: z.string().email().optional().nullable(),
  channel: z.string().optional(),
  status: z.string().optional(),
});

const CreateReminderSchema = z.object({
  meetingId: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  remindAt: z.string(), // ISO string
  channel: z.string().default("console"),
  note: z.string().optional(),
  proposeOnly: z.boolean().default(true), // Hard invariant 1 defaults to proposal
});

export const followUpRoutes: FastifyPluginAsync<{
  draftRepository: FollowUpDraftRepository;
  reminderRepository: ReminderRepository;
  proposalRepository: ProposalRepository;
}> = async (fastify, opts) => {
  const { draftRepository, reminderRepository, proposalRepository } = opts;

  // List all drafts for user
  fastify.get(
    "/drafts",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const context: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };
      const drafts = await draftRepository.listByUser(context);
      return reply.code(200).send({ drafts });
    },
  );

  // List drafts for specific meeting
  fastify.get<{ Params: { id: string } }>(
    "/meetings/:id/drafts",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const context: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };
      try {
        const drafts = await draftRepository.listByMeeting(
          context,
          request.params.id,
        );
        return reply.code(200).send({ drafts });
      } catch {
        return reply.code(403).send({ error: "access_denied" });
      }
    },
  );

  // Create a new draft
  fastify.post(
    "/drafts",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const context: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };
      const parse = CreateDraftSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: "invalid_body", details: parse.error.flatten() });
      }

      try {
        const draft = await draftRepository.create(context, parse.data);
        return reply.code(201).send({ draft });
      } catch {
        return reply.code(403).send({ error: "access_denied" });
      }
    },
  );

  // Update a draft
  fastify.put<{ Params: { id: string } }>(
    "/drafts/:id",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const context: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };
      const parse = UpdateDraftSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: "invalid_body", details: parse.error.flatten() });
      }

      try {
        const draft = await draftRepository.update(
          context,
          request.params.id,
          parse.data,
        );
        return reply.code(200).send({ draft });
      } catch {
        return reply.code(404).send({ error: "draft_not_found" });
      }
    },
  );

  // Create proposal to send draft (Hard Invariant 1)
  fastify.post<{ Params: { id: string } }>(
    "/drafts/:id/propose-send",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const context: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };

      const draft = await draftRepository.findById(context, request.params.id);
      if (!draft) {
        return reply.code(404).send({ error: "draft_not_found" });
      }

      const proposal = await proposalRepository.createPending(context, {
        meetingId: draft.meetingId,
        actionType: ProposalActionType.DRAFT_EMAIL,
        payload: {
          draftId: draft.id,
          recipientEmail: draft.recipientEmail,
          recipientName: draft.recipientName,
          subject: draft.subject,
          body: draft.body,
          channel: draft.channel,
        },
        reason: `طلب إرسال مسودة الرسالة إلى: ${draft.recipientEmail || draft.recipientName || "العميل"}`,
      });

      return reply.code(201).send({ proposal });
    },
  );

  // List all reminders for user
  fastify.get(
    "/reminders",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const context: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };
      const reminders = await reminderRepository.listByUser(context);
      return reply.code(200).send({ reminders });
    },
  );

  // List reminders for specific meeting
  fastify.get<{ Params: { id: string } }>(
    "/meetings/:id/reminders",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const context: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };
      const reminders = await reminderRepository.listByMeeting(
        context,
        request.params.id,
      );
      return reply.code(200).send({ reminders });
    },
  );

  // Create reminder (as proposal or direct scheduled reminder)
  fastify.post(
    "/reminders",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const context: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };
      const parse = CreateReminderSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.code(400).send({ error: "invalid_body", details: parse.error.flatten() });
      }

      const remindAt = new Date(parse.data.remindAt);

      if (parse.data.proposeOnly) {
        // Enforce Hard Invariant 1: create Proposal first
        const proposal = await proposalRepository.createPending(context, {
          meetingId: parse.data.meetingId ?? undefined,
          actionType: ProposalActionType.SEND_REMINDER,
          payload: {
            meetingId: parse.data.meetingId,
            taskId: parse.data.taskId,
            remindAt: remindAt.toISOString(),
            channel: parse.data.channel,
            note: parse.data.note,
          },
          reason: parse.data.note ? `تذكير: ${parse.data.note}` : "طلب تذكير جديد",
        });
        return reply.code(201).send({ proposal, isProposal: true });
      }

      const reminder = await reminderRepository.create(context, {
        meetingId: parse.data.meetingId,
        taskId: parse.data.taskId,
        remindAt,
        channel: parse.data.channel,
      });

      return reply.code(201).send({ reminder, isProposal: false });
    },
  );

  // Cancel reminder
  fastify.post<{ Params: { id: string } }>(
    "/reminders/:id/cancel",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = request.user!;
      const context: TenantContext = {
        userId: user.id,
        role: user.role as Role,
      };

      try {
        const reminder = await reminderRepository.cancel(context, request.params.id);
        return reply.code(200).send({ reminder });
      } catch {
        return reply.code(404).send({ error: "reminder_not_found" });
      }
    },
  );
};
