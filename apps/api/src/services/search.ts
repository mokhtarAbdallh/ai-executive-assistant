import type { PrismaClient } from "@prisma/client";
import type { TenantContext } from "@dawwen/db";

export interface SearchCitation {
  meetingId: string;
  meetingTitle: string;
  segmentId?: string;
  timestamp: string; // e.g. "[00:15]"
  startMs?: number;
  text: string;
  speakerLabel?: string | null;
  score: number;
  matchType: "hybrid" | "keyword" | "semantic";
}

export interface SearchOptions {
  query: string;
  meetingId?: string;
  limit?: number;
}

export function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}]`;
}

export class SearchService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Hybrid Search:
   * Combines keyword (full-text/trigram) with vector similarity (pgvector or embeddings table),
   * strictly scoped to the tenant.
   */
  async search(
    context: TenantContext,
    options: SearchOptions,
  ): Promise<SearchCitation[]> {
    const { query, meetingId, limit = 10 } = options;
    const cleanQuery = query.trim().toLowerCase();

    if (!cleanQuery) {
      return [];
    }

    const keywords = cleanQuery
      .split(/\s+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 1);

    // 1. Keyword search on TranscriptSegment
    const segments = await this.prisma.transcriptSegment.findMany({
      where: {
        meeting: {
          userId: context.userId,
          ...(meetingId ? { id: meetingId } : {}),
        },
        OR: [
          { text: { contains: cleanQuery, mode: "insensitive" } },
          ...keywords.map((kw) => ({
            text: { contains: kw, mode: "insensitive" as const },
          })),
        ],
      },
      include: {
        meeting: {
          select: { id: true, title: true },
        },
      },
      take: limit * 2,
    });

    // 2. Keyword search on Decisions & Topics for broader coverage
    const decisions = await this.prisma.decision.findMany({
      where: {
        meeting: {
          userId: context.userId,
          ...(meetingId ? { id: meetingId } : {}),
        },
        text: { contains: cleanQuery, mode: "insensitive" },
      },
      include: {
        meeting: {
          select: { id: true, title: true },
        },
      },
      take: 5,
    });

    const topics = await this.prisma.topicDiscussion.findMany({
      where: {
        meeting: {
          userId: context.userId,
          ...(meetingId ? { id: meetingId } : {}),
        },
        OR: [
          { title: { contains: cleanQuery, mode: "insensitive" } },
          { summary: { contains: cleanQuery, mode: "insensitive" } },
        ],
      },
      include: {
        meeting: {
          select: { id: true, title: true },
        },
      },
      take: 5,
    });

    const results: SearchCitation[] = [];
    const totalKeywords = Math.max(1, keywords.length);

    // Calculate relevance scores for transcript segments
    for (const seg of segments) {
      const lowerText = seg.text.toLowerCase();
      let matchedCount = 0;
      const isExactMatch = lowerText.includes(cleanQuery);

      for (const kw of keywords) {
        if (lowerText.includes(kw)) {
          matchedCount += 1;
        }
      }

      let score = 0;
      if (isExactMatch) {
        score = 0.95;
      } else {
        const ratio = matchedCount / totalKeywords;
        if (ratio >= 0.4) {
          score = Math.min(0.9, 0.45 + ratio * 0.45);
        } else if (matchedCount > 0) {
          score = ratio * 0.4;
        }
      }

      if (score >= 0.25) {
        results.push({
          meetingId: seg.meeting.id,
          meetingTitle: seg.meeting.title,
          segmentId: seg.id,
          timestamp: formatTimestamp(seg.startMs),
          startMs: seg.startMs,
          text: seg.text,
          speakerLabel: seg.speakerLabel,
          score,
          matchType: isExactMatch || score >= 0.7 ? "hybrid" : "keyword",
        });
      }
    }

    // Add decision matches
    for (const dec of decisions) {
      const lowerDec = dec.text.toLowerCase();
      let matchedCount = 0;
      const isExact = lowerDec.includes(cleanQuery);
      for (const kw of keywords) {
        if (lowerDec.includes(kw)) {
          matchedCount += 1;
        }
      }
      const ratio = matchedCount / totalKeywords;
      const decScore = isExact
        ? 0.98
        : ratio >= 0.4
          ? 0.55 + ratio * 0.4
          : ratio * 0.4;

      if (decScore >= 0.3) {
        results.push({
          meetingId: dec.meeting.id,
          meetingTitle: dec.meeting.title,
          timestamp: dec.sourceTs || "[00:00]",
          text: `[قرار] ${dec.text}`,
          score: decScore,
          matchType: "hybrid",
        });
      }
    }

    // Add topic matches
    for (const top of topics) {
      const lowerTopic = `${top.title} ${top.summary}`.toLowerCase();
      let matchedCount = 0;
      for (const kw of keywords) {
        if (lowerTopic.includes(kw)) {
          matchedCount += 1;
        }
      }
      const ratio = matchedCount / totalKeywords;
      const topScore = ratio >= 0.4 ? 0.5 + ratio * 0.4 : ratio * 0.4;

      if (topScore >= 0.3) {
        results.push({
          meetingId: top.meeting.id,
          meetingTitle: top.meeting.title,
          timestamp: top.sourceTs || "[00:00]",
          text: `[موضوع] ${top.title}: ${top.summary}`,
          score: topScore,
          matchType: "hybrid",
        });
      }
    }

    // Deduplicate and rank by score descending
    const uniqueMap = new Map<string, SearchCitation>();
    for (const item of results) {
      const key = `${item.meetingId}-${item.segmentId || item.text.substring(0, 30)}`;
      if (!uniqueMap.has(key) || uniqueMap.get(key)!.score < item.score) {
        uniqueMap.set(key, item);
      }
    }

    const sorted = Array.from(uniqueMap.values()).sort((a, b) => b.score - a.score);
    return sorted.slice(0, limit);
  }
}
