import type { Proposal, ProposalStatus } from "@dawwen/db";

interface UpdateManyArgs {
  where: { id: string; userId?: string; status?: { in: ProposalStatus[] } };
  data: Partial<Proposal>;
}

/**
 * In-memory `proposal.updateMany` with Postgres semantics: the conditional update
 * only matches when id, owner and allowed source status all match, and it is
 * applied synchronously (atomically) per call — like a row-locked UPDATE.
 */
export function proposalUpdateMany(store: Map<string, Proposal>) {
  return ({ where, data }: UpdateManyArgs): Promise<{ count: number }> => {
    const record = store.get(where.id);
    if (
      !record ||
      (where.userId !== undefined && record.userId !== where.userId) ||
      (where.status && !where.status.in.includes(record.status))
    ) {
      return Promise.resolve({ count: 0 });
    }
    store.set(where.id, { ...record, ...data, updatedAt: new Date() } as Proposal);
    return Promise.resolve({ count: 1 });
  };
}
