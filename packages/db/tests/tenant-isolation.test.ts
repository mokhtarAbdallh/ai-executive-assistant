import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { MeetingRepository } from "../src/repositories/meeting.repository.js";
import { TaskRepository } from "../src/repositories/task.repository.js";
import { ProposalRepository } from "../src/repositories/proposal.repository.js";
import { CrossTenantAccessViolationError } from "../src/repositories/base.js";
import { ProposalActionType, ProposalStatus, MeetingStatus } from "@prisma/client";

describe("Tenant Isolation Invariant: A user can never read or modify another user's data", () => {
  const userA = { userId: "user-alice-111" };
  const userB = { userId: "user-bob-222" };

  it("throws CrossTenantAccessViolationError when User B tries to read User A's meeting", async () => {
    const mockPrisma = {
      meeting: {
        findUnique: vi.fn().mockResolvedValue({
          id: "meeting-alice-01",
          userId: userA.userId,
          title: "Alice Private Strategy Meeting",
        }),
      },
    } as unknown as PrismaClient;

    const repo = new MeetingRepository(mockPrisma);

    // Alice reading her own meeting succeeds
    const aliceView = await repo.findById(userA, "meeting-alice-01");
    expect(aliceView?.title).toBe("Alice Private Strategy Meeting");

    // Bob trying to read Alice's meeting throws CrossTenantAccessViolationError
    await expect(repo.findById(userB, "meeting-alice-01")).rejects.toThrow(
      CrossTenantAccessViolationError,
    );
  });

  it("throws CrossTenantAccessViolationError when User B tries to update or delete User A's meeting", async () => {
    const mockPrisma = {
      meeting: {
        findUnique: vi.fn().mockResolvedValue({
          id: "meeting-alice-02",
          userId: userA.userId,
          title: "Alice Confidential",
        }),
        update: vi.fn(),
        delete: vi.fn(),
      },
    } as unknown as PrismaClient;

    const repo = new MeetingRepository(mockPrisma);

    await expect(
      repo.updateStatus(userB, "meeting-alice-02", MeetingStatus.APPROVED),
    ).rejects.toThrow(CrossTenantAccessViolationError);

    await expect(repo.delete(userB, "meeting-alice-02")).rejects.toThrow(
      CrossTenantAccessViolationError,
    );

    expect(mockPrisma.meeting.update).not.toHaveBeenCalled();
    expect(mockPrisma.meeting.delete).not.toHaveBeenCalled();
  });

  it("throws CrossTenantAccessViolationError when User B tries to read User A's task", async () => {
    const mockPrisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: "task-alice-01",
          title: "Prepare Q3 financial report",
          meeting: {
            userId: userA.userId,
          },
        }),
      },
    } as unknown as PrismaClient;

    const repo = new TaskRepository(mockPrisma);

    // Alice reading her task succeeds
    const aliceTask = await repo.findById(userA, "task-alice-01");
    expect(aliceTask?.title).toBe("Prepare Q3 financial report");

    // Bob trying to read Alice's task throws CrossTenantAccessViolationError
    await expect(repo.findById(userB, "task-alice-01")).rejects.toThrow(
      CrossTenantAccessViolationError,
    );
  });

  it("throws CrossTenantAccessViolationError when User B tries to approve User A's proposal", async () => {
    const mockUpdate = vi.fn();
    const mockPrisma = {
      proposal: {
        findUnique: vi.fn().mockResolvedValue({
          id: "proposal-alice-calendar",
          userId: userA.userId,
          actionType: ProposalActionType.SCHEDULE_MEETING,
          status: ProposalStatus.PENDING_APPROVAL,
          payload: { summary: "Followup call" },
        }),
        update: mockUpdate,
      },
    } as unknown as PrismaClient;

    const repo = new ProposalRepository(mockPrisma);

    // Bob attempting to approve Alice's proposal fails with CrossTenantAccessViolationError
    await expect(repo.approve(userB, "proposal-alice-calendar")).rejects.toThrow(
      CrossTenantAccessViolationError,
    );

    expect(mockUpdate).not.toHaveBeenCalled();

    // Alice approving her own proposal succeeds
    mockUpdate.mockResolvedValueOnce({
      id: "proposal-alice-calendar",
      status: ProposalStatus.APPROVED,
    });

    const approved = await repo.approve(userA, "proposal-alice-calendar");
    expect(approved.status).toBe(ProposalStatus.APPROVED);
  });
});
