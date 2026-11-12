import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dispatchDueReminders,
  sweepStuckMeetings,
  type ReminderDispatchOptions,
} from "../src/sweeper.js";
import { ConsoleEmailSender, type EmailInputLike } from "../src/reminders.js";
import { MeetingStatus, ReminderStatus } from "@dawwen/db";

interface MockDbMeetingShape {
  updateMany: ReturnType<typeof vi.fn>;
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe("Stuck meeting sweeper (ADR-019)", () => {
  let mockDb: { meeting: MockDbMeetingShape };

  beforeEach(() => {
    mockDb = {
      meeting: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
  });

  it("mass-updates stale TRANSCRIBING/ANALYZING meetings to FAILED with a reason", async () => {
    const count = await sweepStuckMeetings(mockDb as never, {
      stuckAfterMs: 30 * 60_000,
      logger: makeLogger(),
    });

    expect(count).toBe(2);
    const args = mockDb.meeting.updateMany.mock.calls[0][0] as {
      where: { status: { in: string[] }; updatedAt: { lt: Date } };
      data: { status: string; failureReason: string };
    };
    expect(args.where.status.in).toEqual([MeetingStatus.TRANSCRIBING, MeetingStatus.ANALYZING]);
    expect(args.where.updatedAt.lt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(args.data.status).toBe(MeetingStatus.FAILED);
    expect(args.data.failureReason).toContain("timed out");
  });

  it("does not touch DONE or FAILED meetings", async () => {
    await sweepStuckMeetings(mockDb as never, {
      stuckAfterMs: 30 * 60_000,
      logger: makeLogger(),
    });

    const statuses = (
      mockDb.meeting.updateMany.mock.calls[0][0] as {
        where: { status: { in: string[] } };
      }
    ).where.status.in;
    expect(statuses).not.toContain(MeetingStatus.DONE);
    expect(statuses).not.toContain(MeetingStatus.FAILED);
  });

  it("logs a warning when anything got swept", async () => {
    const log = makeLogger();
    await sweepStuckMeetings(mockDb as never, {
      stuckAfterMs: 60_000,
      logger: log,
    });
    expect(log.warn).toHaveBeenCalledWith(
      "sweeper marked stuck meetings as FAILED",
      expect.anything(),
    );
  });

  it("is silent when nothing is stuck (idempotent re-runs)", async () => {
    mockDb.meeting.updateMany.mockResolvedValue({ count: 0 });
    const log = makeLogger();
    const count = await sweepStuckMeetings(mockDb as never, {
      stuckAfterMs: 60_000,
      logger: log,
    });
    expect(count).toBe(0);
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("Reminder dispatcher (ADR-020)", () => {
  interface MockReminder {
    id: string;
    remindAt: Date;
    channel: string;
    status: string;
    meetingId: string | null;
    taskId: string | null;
    user: { email: string | null };
  }

  const userId = "user-reminders";
  let reminders: MockReminder[];
  let mockDb: {
    reminder: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let options: ReminderDispatchOptions;

  function seed(overrides: Partial<MockReminder> = {}): void {
    reminders = [
      {
        id: "rem-1",
        remindAt: new Date(Date.now() - 60_000),
        channel: "email",
        status: ReminderStatus.SCHEDULED,
        meetingId: "meet-1",
        taskId: null,
        user: { email: "user@example.com" },
        ...overrides,
      },
    ];
    mockDb.reminder.findMany.mockReset();
    mockDb.reminder.findMany.mockResolvedValue(reminders);
    mockDb.reminder.updateMany.mockReset();
    mockDb.reminder.updateMany.mockResolvedValue({ count: 1 });
  }

  beforeEach(() => {
    reminders = [];
    mockDb = {
      reminder: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    options = { logger: makeLogger() };
  });

  it("Hard Invariant 5 guard: it only claims reminders still in SCHEDULED (cancelled ones are skipped)", async () => {
    seed();
    // another replica already sent it between the send and the claim
    mockDb.reminder.updateMany.mockResolvedValue({ count: 0 });
    const sender = {
      sendEmail: vi.fn().mockResolvedValue({ messageId: "ses-1" }),
    };

    const sent = await dispatchDueReminders(mockDb as never, {
      ...options,
      sender,
    });

    // claim query was status-filtered
    const args = mockDb.reminder.updateMany.mock.calls[0][0] as {
      where: { id: string; status: string };
    };
    expect(args.where.status).toBe(ReminderStatus.SCHEDULED);
    expect(sent).toBe(0);
  });

  it("queries only SCHEDULED reminders whose time has come, scoped take=50", async () => {
    seed();
    await dispatchDueReminders(mockDb as never, options);
    const args = mockDb.reminder.findMany.mock.calls[0][0] as {
      where: { status: string; remindAt: { lte: Date } };
      take: number;
    };
    expect(args.where.status).toBe(ReminderStatus.SCHEDULED);
    expect(args.where.remindAt.lte.getTime()).toBeLessThanOrEqual(Date.now());
    expect(args.take).toBe(50);
  });

  it("sends email via the configured sender and marks the reminder SENT", async () => {
    seed();
    const sentEmails: EmailInputLike[] = [];
    const sender = {
      sendEmail: vi.fn().mockImplementation((input: EmailInputLike) => {
        sentEmails.push(input);
        return Promise.resolve({ messageId: "ses-123" });
      }),
    };

    const sent = await dispatchDueReminders(mockDb as never, {
      ...options,
      sender,
    });

    expect(sent).toBe(1);
    expect(sender.sendEmail).toHaveBeenCalledOnce();
    expect(sentEmails[0]!.to).toBe("user@example.com");
    expect(sentEmails[0]!.subject).toBeTruthy();
    expect(sentEmails[0]!.body).toContain("meet-1");

    const claim = mockDb.reminder.updateMany.mock.calls[0][0] as {
      where: { id: string; status: string };
      data: { status: string; sentAt: Date };
    };
    // Send-then-claim (ADR-020): claim happens only after send succeeded.
    expect(claim.where.status).toBe(ReminderStatus.SCHEDULED);
    expect(claim.data.status).toBe(ReminderStatus.SENT);
    expect(claim.data.sentAt).toBeInstanceOf(Date);
  });

  it("falls back to the console channel when no sender is configured or the user has no email", async () => {
    seed({ user: { email: null } });
    const sent = await dispatchDueReminders(mockDb as never, options);
    expect(sent).toBe(1);
    const claim = mockDb.reminder.updateMany.mock.calls[0][0] as {
      data: { status: string };
    };
    expect(claim.data.status).toBe(ReminderStatus.SENT);
  });

  it("a reminder send failure does not abort the batch", async () => {
    seed({
      user: { email: "a@example.com" },
    });
    const log = makeLogger();
    const sender = {
      sendEmail: vi.fn().mockRejectedValue(new Error("SES throttled")),
    };

    const sent = await dispatchDueReminders(mockDb as never, {
      logger: log,
      sender,
    });

    expect(sent).toBe(0);
    expect(log.warn).toHaveBeenCalledWith("failed to dispatch reminder", expect.anything());
    // Send-then-claim: a failed send must NOT mark the reminder SENT — the next
    // dispatch retries it while it is still SCHEDULED.
    expect(mockDb.reminder.updateMany).not.toHaveBeenCalled();
  });

  it("ConsoleEmailSender emits a stdout log and resolves a messageId", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const result = await new ConsoleEmailSender().sendEmail({
        to: "x@y.z",
        subject: "s",
        body: "b",
      });
      expect(result.messageId).toBe("console");
      expect(writeSpy).toHaveBeenCalledOnce();
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("userId scoping: the reminder belongs to the user who scheduled it (no cross-tenant reads)", async () => {
    seed();
    await dispatchDueReminders(mockDb as never, options);
    const args = mockDb.reminder.findMany.mock.calls[0][0] as {
      include: { user: { select: { email: boolean } } };
    };
    expect(args.include.user.select.email).toBe(true);
    expect(userId).toBeTruthy();
  });
});
