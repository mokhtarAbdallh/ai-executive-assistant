import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CalendarConnectionRepository, PrismaClient } from "@dawwen/db";
import type { CalendarProvider } from "../services/calendar.js";
import type { TokenEncryptor, GoogleOAuthTokens } from "@dawwen/shared";
import { createOAuthState, verifyOAuthState } from "../services/oauth-state.js";

interface CalendarRoutesOptions {
  calendarConnectionRepository: CalendarConnectionRepository;
  calendarProvider: CalendarProvider;
  tokenEncryptor: TokenEncryptor;
  prisma: PrismaClient;
  /** Secret used to sign the OAuth `state` (derived from APP_SECRET). */
  stateSecret: string;
}

/** Public origin for OAuth redirects (behind the ALB the Host may be internal, ADR-017). */
function publicBaseUrl(request: { protocol: string; hostname: string }): string {
  return process.env.PUBLIC_BASE_URL || `${request.protocol}://${request.hostname}`;
}

export async function calendarRoutes(
  fastify: FastifyInstance,
  options: CalendarRoutesOptions,
): Promise<void> {
  const { calendarConnectionRepository, calendarProvider, tokenEncryptor, prisma, stateSecret } =
    options;

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
      const state = createOAuthState(stateSecret, user.id);
      const redirectUri = `${publicBaseUrl(request)}/api/calendar/callback`;
      const authUrl = calendarProvider.getAuthUrl(state, redirectUri);
      return reply.send({ authUrl });
    },
  );

  // 3. OAuth callback. Google redirects the browser here with GET ?code&state —
  // there is no Bearer token, so the signed state identifies the user (ADR-023).
  // The browser is sent back to the web app with ?calendar=connected|error.
  const CallbackQuerySchema = z.object({
    code: z.string().min(1).optional(),
    state: z.string().min(1).max(2048).optional(),
    error: z.string().optional(),
  });

  fastify.get("/calendar/callback", async (request, reply) => {
    const back = (result: "connected" | "error") =>
      reply.redirect(`${process.env.PUBLIC_BASE_URL ?? ""}/?calendar=${result}`);

    const parsed = CallbackQuerySchema.safeParse(request.query);
    if (!parsed.success || !parsed.data.code || !parsed.data.state || parsed.data.error) {
      return back("error");
    }

    let userId: string;
    try {
      userId = verifyOAuthState(stateSecret, parsed.data.state);
    } catch (err) {
      request.log.warn({ reason: (err as Error).message }, "calendar callback rejected");
      return back("error");
    }

    try {
      const redirectUri = `${publicBaseUrl(request)}/api/calendar/callback`;
      const tokens = await calendarProvider.exchangeCode(parsed.data.code, redirectUri);
      await calendarConnectionRepository.upsertConnection(
        { userId },
        {
          provider: "google",
          encryptedTokens: await tokenEncryptor.encrypt(tokens),
          calendarId: "primary",
          syncStatus: "connected",
        },
      );
    } catch (err) {
      request.log.error({ userId, err: (err as Error).message }, "calendar connect failed");
      return back("error");
    }
    return back("connected");
  });

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
