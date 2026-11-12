/**
 * Tiny in-memory stand-in for the Prisma calls the worker pipeline makes. It
 * implements just enough of Prisma's semantics (conditional updateMany,
 * createMany, deleteMany, array/interactive $transaction) for unit tests;
 * real concurrency is covered by the `*.db.test.ts` suites.
 */
import { vi } from "vitest";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; lt?: Date; gt?: unknown };
      if (c.in) return c.in.includes(value);
      if (c.lt) return value instanceof Date && value < c.lt;
      if (c.gt !== undefined) return (value as bigint | number) > (c.gt as bigint | number);
    }
    return value === cond;
  });
}

const MODELS = [
  "meeting",
  "userSettings",
  "recordingConsent",
  "transcriptSegment",
  "meetingEmbedding",
  "meetingAnalysis",
  "agendaItem",
  "topicDiscussion",
  "decision",
  "task",
  "openQuestion",
  "documentReference",
  "proposal",
  "usageEvent",
] as const;

export type MemoryPrisma = ReturnType<typeof createMemoryPrisma>;

export function createMemoryPrisma() {
  const tables: Record<string, Row[]> = Object.fromEntries(MODELS.map((m) => [m, []]));
  let seq = 0;
  const nextId = (model: string) => `${model}-${++seq}`;

  const model = (name: string) => {
    const rows = tables[name]!;
    return {
      findUnique: vi.fn(
        async ({ where }: { where: Where }) => rows.find((r) => matches(r, where)) ?? null,
      ),
      findFirst: vi.fn(
        async ({ where }: { where?: Where } = {}) => rows.find((r) => matches(r, where)) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where?: Where } = {}) =>
        rows.filter((r) => matches(r, where)),
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: nextId(name), ...data };
        rows.push(row);
        return row;
      }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        for (const d of data) rows.push({ id: nextId(name), ...d });
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: { where: Where; data: Row }) => {
        const row = rows.find((r) => matches(r, where));
        if (!row) throw new Error(`${name} not found`);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where?: Where; data: Row }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const row of hit) Object.assign(row, data, { updatedAt: new Date() });
        return { count: hit.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where?: Where } = {}) => {
        const keep = rows.filter((r) => !matches(r, where));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return { count };
      }),
    };
  };

  const client: Record<string, unknown> & {
    tables: typeof tables;
    $executeRaw: ReturnType<typeof vi.fn>;
  } = {
    tables,
    $executeRaw: vi.fn(async () => 1),
  };
  for (const name of MODELS) client[name] = model(name);
  client.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(client)
      : Promise.all(arg as Promise<unknown>[]),
  );
  return client as typeof client & Record<(typeof MODELS)[number], ReturnType<typeof model>>;
}

/** Seeds a queued, consented meeting and returns the prisma mock. */
export function seedQueuedMeeting(
  db: MemoryPrisma,
  opts: { meetingId: string; userId: string; s3Key: string; retentionDays?: number },
) {
  db.tables.meeting!.push({
    id: opts.meetingId,
    userId: opts.userId,
    title: "Sprint Review & Planning",
    status: "QUEUED",
    language: "ar",
    scheduledStart: null,
    audioS3Key: opts.s3Key,
    audioDurationSeconds: null,
    audioDeletedAt: null,
    failureReason: null,
    creditHoldMicros: 0n,
    updatedAt: new Date(),
  });
  db.tables.userSettings!.push({
    userId: opts.userId,
    audioRetentionDays: opts.retentionDays ?? 0,
  });
  db.tables.recordingConsent!.push({
    id: "consent-1",
    userId: opts.userId,
    meetingId: opts.meetingId,
    participantName: "Test Participant",
  });
}
