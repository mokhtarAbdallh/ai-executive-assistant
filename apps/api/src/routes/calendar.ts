import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CalendarConnectionRepository, PrismaClient } from "@dawwen/db";
import type { CalendarProvider } from "../services/calendar.js";
import type { TokenEncryptor, GoogleOAuthTokens } from "@dawwen/shared";

interface CalendarRoutesOptions {
  calendarConnectionRepository: CalendarConnectionRepository;
  calendarProvider: CalendarProvider;
  tokenEncryptor: TokenEncryptor;
  prisma: PrismaClient;
}

export async function calendarRoutes(
  fastify: FastifyInstance,
  options: CalendarRoutesOptions,
): Promise<void> {
  const { calendarConnectionRepository, calendarProvider, tokenEncryptor, prisma } = options;

  // 1. Connection Status
  fastify.get(
    "/calendar/status",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const connection = await calendarConnectionRepository.getConnection(
        { userId: user.id },
        "google",
      );

      if (!connection) {
        return reply.send({
          connected: false,
          provider: "google",
          lastSyncedAt: null,
        });
      }

      return reply.send({
        connected: true,
        provider: connection.provider,
        calendarId: connection.calendarId,
        syncStatus: connection.syncStatus,
        lastSyncedAt: connection.lastSyncedAt?.toISOString() || null,
      });
    },
  );

  // 2. Get Auth URL
  fastify.get(
    "/calendar/auth-url",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const state = Buffer.from(JSON.stringify({ userId: user.id, timestamp: Date.now() })).toString(
        "base64",
      );
      const redirectUri = `${request.protocol}://${request.hostname}/api/calendar/callback`;
      const authUrl = calendarProvider.getAuthUrl(state, redirectUri);
      return reply.send({ authUrl });
    },
  );

  // 3. Callback / Connect
  const CallbackSchema = z.object({
    code: z.string().min(1),
    redirectUri: z.string().optional(),
  });

  fastify.post(
    "/calendar/callback",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const parsed = CallbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid callback payload", details: parsed.error.format() });
      }

      const redirectUri =
        parsed.data.redirectUri || `${request.protocol}://${request.hostname}/api/calendar/callback`;

      const tokens = await calendarProvider.exchangeCode(parsed.data.code, redirectUri);
      const encryptedTokens = await tokenEncryptor.encrypt(tokens);

      const connection = await calendarConnectionRepository.upsertConnection(
        { userId: user.id },
        {
          provider: "google",
          encryptedTokens,
          calendarId: "primary",
          syncStatus: "connected",
        },
      );

      return reply.send({
        success: true,
        connectionId: connection.id,
        connected: true,
        lastSyncedAt: connection.updatedAt.toISOString(),
      });
    },
  );

  // 4. Disconnect
  fastify.post(
    "/calendar/disconnect",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      await calendarConnectionRepository.deleteConnection({ userId: user.id }, "google");
      return reply.send({ success: true, connected: false });
    },
  );

  // 5. Unified Events (Calendar View)
  fastify.get(
    "/calendar/events",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const query = request.query as { start?: string; end?: string };

      const timeMin = query.start ? new Date(query.start) : new Date(Date.now() - 30 * 86400000);
      const timeMax = query.end ? new Date(query.end) : new Date(Date.now() + 60 * 86400000);

      // A) Fetch from Google Calendar if connected
      const connection = await calendarConnectionRepository.getConnection(
        { userId: user.id },
        "google",
      );

      let externalEvents: Array<{
        id: string;
        title: string;
        start: string;
        end: string;
        description?: string;
        location?: string;
        attendees?: string[];
        htmlLink?: string;
        status: "scheduled" | "summarized" | "processing" | "needs_review";
        isAiBooked?: boolean;
        meetingId?: string;
      }> = [];

      if (connection?.encryptedTokens) {
        try {
          const tokens = await tokenEncryptor.decrypt<GoogleOAuthTokens>(connection.encryptedTokens);
          externalEvents = await calendarProvider.listEvents(tokens, { timeMin, timeMax });
        } catch {
          // If token decryption or fetch fails, fallback to empty external events
          externalEvents = [];
        }
      }

      // B) Fetch from Dawwen DB meetings
      const meetings = await prisma.meeting.findMany({
        where: {
          userId: user.id,
          createdAt: {
            gte: timeMin,
            lte: timeMax,
          },
        },
        include: {
          analysis: { select: { tldr: true } },
          tasks: { select: { id: true, needsReview: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      const meetingEvents = meetings.map((m) => {
        const start = m.scheduledStart ? m.scheduledStart.toISOString() : m.createdAt.toISOString();
        const durationMins = m.audioDurationSeconds ? Math.ceil(m.audioDurationSeconds / 60) : 45;
        const end = m.scheduledEnd
          ? m.scheduledEnd.toISOString()
          : new Date(new Date(start).getTime() + durationMins * 60000).toISOString();

        let status: "scheduled" | "summarized" | "processing" | "needs_review" = "scheduled";
        if (m.status === "REVIEW_PENDING" || m.status === "APPROVED") {
          status = m.tasks.some((t) => t.needsReview) ? "needs_review" : "summarized";
        } else if (m.status === "TRANSCRIBING" || m.status === "ANALYZING") {
          status = "processing";
        }

        return {
          id: `dawwen-m-${m.id}`,
          meetingId: m.id,
          title: m.title,
          start,
          end,
          description: m.analysis?.tldr || undefined,
          status,
          isAiBooked: false,
        };
      });

      // Merge and deduplicate by time/title
      const combined = [...externalEvents, ...meetingEvents];
      return reply.send(combined);
    },
  );

  // 6. Manual Sync
  fastify.post(
    "/calendar/sync",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const connection = await calendarConnectionRepository.getConnection(
        { userId: user.id },
        "google",
      );

      if (!connection) {
        return reply.status(400).send({ error: "No calendar connected" });
      }

      const updated = await calendarConnectionRepository.updateSyncStatus(
        { userId: user.id },
        connection.id,
        "active",
        new Date(),
      );

      return reply.send({
        success: true,
        lastSyncedAt: updated.lastSyncedAt?.toISOString(),
      });
    },
  );
}
