import type { PrismaClient } from "@dawwen/db";
import {
  MeetingStatus,
  ReminderStatus,
} from "@dawwen/db";
import type {
  EmailInputLike,
  ReminderEmailSender,
} from "./reminders.js";

export interface SweeperOptions {
  /** Meetings in TRANSCRIBING/ANALYZING older than this are marked FAILED. */
  stuckAfterMs: number;
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Stale-job sweeper (ADR-019): meetings whose worker crashed mid-pipeline would
 * otherwise stay in TRANSCRIBING/ANALYZING forever (SQS gives up after
 * maxReceiveCount and moves the message to the DLQ — nobody consumed it).
 * Idempotent: it only flips statuses that should never be settled again.
 */
export async function sweepStuckMeetings(
  prisma: PrismaClient,
  options: SweeperOptions,
): Promise<number> {
  const { stuckAfterMs, logger } = options;
  const cutoff = new Date(Date.now() - stuckAfterMs);

  const result = await prisma.meeting.updateMany({
    where: {
      status: { in: [MeetingStatus.TRANSCRIBING, MeetingStatus.ANALYZING] },
      updatedAt: { lt: cutoff },
    },
    data: {
      status: MeetingStatus.FAILED,
      failureReason: `Processing timed out after ${Math.round(stuckAfterMs / 60_000)} minutes (likely worker crash). Re-upload the audio to retry.`,
    },
  });

  if (result.count > 0) {
    logger?.warn("sweeper marked stuck meetings as FAILED", {
      count: result.count,
      olderThanMs: stuckAfterMs,
    });
  }
  return result.count;
}

export interface ReminderDispatchOptions {
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
  sender?: ReminderEmailSender;
}

/**
 * Reminder dispatcher (ADR-020): picks SCHEDULED reminders whose time has come,
 * delivers them via the configured channel, and marks them SENT.
 *
 * Note: `_count`-based claim is a single scan; with multiple workers there is a
 * small duplicate-send race (documented in ADR-020). Keep worker_min=1 or use
 * the channel idempotency of SES for now.
 */
export async function dispatchDueReminders(
  prisma: PrismaClient,
  options: ReminderDispatchOptions,
): Promise<number> {
  const { logger, sender } = options;
  const now = new Date();

  const due = await prisma.reminder.findMany({
    where: { status: ReminderStatus.SCHEDULED, remindAt: { lte: now } },
    include: { user: { select: { email: true } } },
    take: 50,
    orderBy: { remindAt: "asc" },
  });

  let sent = 0;
  for (const reminder of due) {
    try {
      if (sender && reminder.user.email) {
        // Send-then-claim (ADR-020): a duplicated reminder is an annoyance, a
        // silently dropped one is a missed meeting — so we only claim after a
        // successful send. A crash in between causes a duplicate send on the
        // next dispatch, and a failed claim (another worker already sent it)
        // is skipped via the status guard.
        const input: EmailInputLike = {
          to: reminder.user.email,
          subject: "تذكير من دوّن (Dawwen reminder)",
          body: reminder.meetingId
            ? `تذكير بخصوص اجتماعك: ${reminder.meetingId}\n\n${reminder.channel}`
            : `لديك تذكير مستحق.\n\n${reminder.channel}`,
        };
        const result = await sender.sendEmail(input);
        const claimed = await prisma.reminder.updateMany({
          where: { id: reminder.id, status: ReminderStatus.SCHEDULED },
          data: { status: ReminderStatus.SENT, sentAt: now },
        });
        if (claimed.count === 0) continue; // another replica already sent it
        sent++;
        logger.info("reminder dispatched", {
          reminderId: reminder.id,
          to: input.to,
          messageId: result.messageId,
        });
      } else {
        // Console channel (default): mark SENT and clear the queue.
        const claimed = await prisma.reminder.updateMany({
          where: { id: reminder.id, status: ReminderStatus.SCHEDULED },
          data: { status: ReminderStatus.SENT, sentAt: now },
        });
        if (claimed.count === 0) continue;
        sent++;
        logger.info("reminder marked sent (console channel)", { reminderId: reminder.id });
      }
    } catch (err) {
      logger.warn("failed to dispatch reminder", {
        reminderId: reminder.id,
        error: (err as Error).message,
      });
    }
  }

  return sent;
}
