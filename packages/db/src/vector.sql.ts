import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

/**
 * pgvector helpers (ADR-016): raw SQL in this file only — the project keeps raw
 * SQL for pgvector/full-text inside `*.sql.ts` modules.
 *
 * Vectors are passed as text like "[0.1,0.2]" and CASTed to `vector` in SQL;
 * parameters are bound by Prisma, values never interpolated into the statement.
 */

export interface SavedEmbeddingInput {
  meetingId: string;
  segmentId: string;
  text: string;
  embedding: readonly number[];
  providerName: string;
  /** Token estimate used for metering/audit metadata only. */
  tokenEstimate: number;
}

export function toPgVector(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function saveSegmentEmbedding(
  prisma: PrismaClient,
  input: SavedEmbeddingInput,
): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO meeting_embeddings ("id", "meetingId", "segmentId", "text", "embedding", "metadata", "createdAt")
    VALUES (
      md5(random()::text || clock_timestamp()::text),
      ${input.meetingId},
      ${input.segmentId},
      ${input.text},
      CAST(${toPgVector(input.embedding)} AS vector),
      ${JSON.stringify({
        provider: input.providerName,
        tokenEstimate: input.tokenEstimate,
      })}::jsonb,
      now()
    )
    ON CONFLICT DO NOTHING
  `);
}

/** Replaces all embeddings of a meeting (used when re-processing a transcript). */
export async function replaceMeetingEmbeddings(
  prisma: PrismaClient,
  meetingId: string,
  items: SavedEmbeddingInput[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM meeting_embeddings WHERE "meetingId" = ${meetingId}`);
    for (const item of items) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO meeting_embeddings ("id", "meetingId", "segmentId", "text", "embedding", "metadata", "createdAt")
        VALUES (
          md5(random()::text || clock_timestamp()::text),
          ${item.meetingId},
          ${item.segmentId},
          ${item.text},
          CAST(${toPgVector(item.embedding)} AS vector),
          ${JSON.stringify({ provider: item.providerName, tokenEstimate: item.tokenEstimate })}::jsonb,
          now()
        )
      `);
    }
  });
}

export interface VectorSearchResultRow {
  segmentId: string;
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel: string | null;
  /** 1 - cosine distance: higher = more similar. */
  similarity: number;
}

/**
 * Semantic (cosine) search over meeting embeddings, strictly tenant-scoped by
 * joining `meetings` on the user's meetings. Uses the HNSW cosine index created
 * by the migration (`meeting_embeddings_vector_hnsw_idx`).
 */
export async function searchMeetingEmbeddings(
  prisma: PrismaClient,
  params: {
    userId: string;
    embedding: readonly number[];
    limit?: number;
    meetingId?: string;
  },
): Promise<VectorSearchResultRow[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 10, 50));

  return prisma.$queryRaw<VectorSearchResultRow[]>(Prisma.sql`
    SELECT ts.id AS "segmentId",
           m.id AS "meetingId",
           m.title AS "meetingTitle",
           ts."startMs",
           ts."endMs",
           ts.text,
           ts."speakerLabel",
           (1 - (e.embedding <=> CAST(${toPgVector(params.embedding)} AS vector)::vector))::float8 AS "similarity"
    FROM meeting_embeddings e
    JOIN transcript_segments ts ON ts.id = e."segmentId"
    JOIN meetings m ON m.id = ts."meetingId"
    WHERE m."userId" = ${params.userId}
      AND (${params.meetingId ?? null}::text IS NULL OR m.id = ${params.meetingId ?? null})
    ORDER BY e.embedding <=> CAST(${toPgVector(params.embedding)} AS vector)::vector
    LIMIT ${limit}
  `);
}
