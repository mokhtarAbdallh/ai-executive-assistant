import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalActionType, ProposalStatus, ReminderStatus } from "@dawwen/db";
import {
  ProposalChannelUnavailableError,
  ProposalExecutor,
  ProposalIncompleteError,
} from "../src/services/proposal-executor.js";
import { FakeCalendarProvider } from "../src/services/calendar.js";
import { ConsoleNotificationProvider } from "../src/services/notification.js";

/** ADR-023: the executor never invents data and never reports a simulated side effect. */
describe("ProposalExecutor (production mode: no simulated channels)", () => {
  const ctx = { userId: "u1" };
  let proposal: {
    id: string;
    userId: string;
    meetingId: string | null;
    actionType: ProposalActionType;
    payload: Record<string, unknown>;
    status: ProposalStatus;
  };

  const proposals = {
    findById: vi.fn(async () => ({ ...proposal })),
    approve: vi.fn(async () => {
      proposal.status = ProposalStatus.APPROVED;
      return { ...proposal };
    }),
    claimForExecution: vi.fn(async () => {
      proposal.status = ProposalStatus.EXECUTING;
      return { ...proposal };
    }),
    markExecuted: vi.fn(async () => {
      proposal.status = ProposalStatus.EXECUTED;
      return { ...proposal, executedAt: new Date() };
    }),
    markFailed: vi.fn(async () => ({ ...proposal })),
  };
  const connections = { getConnection: vi.fn() };
  const calendar = new FakeCalendarProvider();
  const encryptor = { decrypt: vi.fn(async () => ({ accessToken: "real" })) };
  const reminders = {
    create: vi.fn(async (_c: unknown, input: { remindAt: Date; status: ReminderStatus }) => ({
      id: "rem-1",
      ...input,
    })),
    findById: vi.fn(),
    updateStatus: vi.fn(),
  };
  const tasks = { create: vi.fn() };
  const email = new ConsoleNotificationProvider();

  const executor = (allowSimulated = false) =>
    new ProposalExecutor(
      proposals as never,
      connections as never,
      calendar,
      encryptor as never,
      undefined,
      reminders as never,
      tasks as never,
      email,
      { allowSimulated },
    );

  beforeEach(() => {
    vi.clearAllMocks();
    connections.getConnection.mockResolvedValue(null);
    proposal = {
      id: "p1",
      userId: "u1",
      meetingId: "m1",
      actionType: ProposalActionType.SCHEDULE_MEETING,
      payload: { title: "Follow-up", proposedDatetime: "2026-12-01T10:00:00.000Z" },
      status: ProposalStatus.PENDING_APPROVAL,
    };
  });

  it("refuses to book a meeting without a date instead of inventing one", async () => {
    proposal.payload = { title: "Follow-up" };
    connections.getConnection.mockResolvedValue({ encryptedTokens: "enc" });

    const err = await executor()
      .approveAndExecute(ctx, "p1")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProposalIncompleteError);
    expect((err as ProposalIncompleteError).missing).toContain("proposedDatetime");
    // Nothing was approved or claimed: the user can still fix or reject it.
    expect(proposals.approve).not.toHaveBeenCalled();
    expect(proposal.status).toBe(ProposalStatus.PENDING_APPROVAL);
  });

  it("refuses to book without a connected calendar (no fake success)", async () => {
    const createEvent = vi.spyOn(calendar, "createEvent");

    await expect(executor().approveAndExecute(ctx, "p1")).rejects.toBeInstanceOf(
      ProposalChannelUnavailableError,
    );

    expect(createEvent).not.toHaveBeenCalled();
    expect(proposals.markExecuted).not.toHaveBeenCalled();
  });

  it("books with the real connection's tokens when connected", async () => {
    connections.getConnection.mockResolvedValue({ encryptedTokens: "enc" });
    const createEvent = vi.spyOn(calendar, "createEvent");

    const result = await executor().approveAndExecute(ctx, "p1");

    expect(result.status).toBe(ProposalStatus.EXECUTED);
    expect(createEvent).toHaveBeenCalledWith(
      { accessToken: "real" },
      expect.objectContaining({ start: new Date("2026-12-01T10:00:00.000Z") }),
    );
  });

  it("the simulated calendar works only when explicitly allowed (dev/demo)", async () => {
    const result = await executor(true).approveAndExecute(ctx, "p1");
    expect(result.status).toBe(ProposalStatus.EXECUTED);
  });

  it("refuses an email without a recipient (no placeholder address)", async () => {
    proposal.actionType = ProposalActionType.DRAFT_EMAIL;
    proposal.payload = { subject: "Notes", body: "Hi" };

    const err = await executor(true)
      .approveAndExecute(ctx, "p1")
      .catch((e: unknown) => e);

    expect((err as ProposalIncompleteError).missing).toContain("recipientEmail");
  });

  it("does not claim an email was sent through the console channel in production", async () => {
    proposal.actionType = ProposalActionType.DRAFT_EMAIL;
    proposal.payload = { recipientEmail: "client@company.com", body: "Hi" };
    const send = vi.spyOn(email, "sendEmail");

    await expect(executor().approveAndExecute(ctx, "p1")).rejects.toMatchObject({
      channel: "email",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("approving a reminder schedules it for its time; nothing is sent now", async () => {
    proposal.actionType = ProposalActionType.SEND_REMINDER;
    proposal.payload = { remindAt: "2026-12-01T08:00:00.000Z", note: "Send the deck" };
    const sendReminder = vi.spyOn(email, "sendReminder");

    const result = await executor().approveAndExecute(ctx, "p1");

    expect(reminders.create).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        remindAt: new Date("2026-12-01T08:00:00.000Z"),
        status: ReminderStatus.SCHEDULED,
      }),
    );
    expect(reminders.updateStatus).not.toHaveBeenCalled();
    expect(sendReminder).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ scheduled: true });
  });

  it("refuses a reminder without a time", async () => {
    proposal.actionType = ProposalActionType.SEND_REMINDER;
    proposal.payload = { note: "Send the deck" };

    const err = await executor()
      .approveAndExecute(ctx, "p1")
      .catch((e: unknown) => e);
    expect((err as ProposalIncompleteError).missing).toContain("remindAt");
  });
});
