import type { MeetingAnalysis } from "./schemas/analysis.js";

/**
 * Citation checks (Invariant 2, ADR-024). The LLM must cite transcript segments
 * that really exist; a made-up id would send the user to a quote that was never said.
 */

type Cited = { sourceSegmentIds: string[] };

function citedSections(analysis: MeetingAnalysis): Array<[string, Cited[]]> {
  return [
    ["topics", analysis.topics],
    ["decisions", analysis.decisions],
    ["actionItems", analysis.actionItems],
  ];
}

/** Human-readable problems (fed back to the model as a repair instruction). */
export function findInvalidCitations(
  analysis: MeetingAnalysis,
  validSegmentIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  for (const [section, items] of citedSections(analysis)) {
    items.forEach((item, index) => {
      const unknown = item.sourceSegmentIds.filter((id) => !validSegmentIds.has(id));
      if (unknown.length > 0) {
        problems.push(
          `${section}[${index}].sourceSegmentIds contains ids that are not in the transcript: ${unknown.join(", ")}`,
        );
      }
    });
  }
  return problems;
}

export interface CitationCleanup {
  analysis: MeetingAnalysis;
  /** Unknown ids removed from items that still had at least one real source. */
  removedIds: number;
  /** Items dropped because none of their sources exist (they cannot be shown with a source). */
  droppedItems: number;
}

/**
 * Last line of defence before persisting: removes unknown ids, and drops items
 * left without any real source. Pure; returns a new analysis object.
 */
export function enforceValidCitations(
  analysis: MeetingAnalysis,
  validSegmentIds: ReadonlySet<string>,
): CitationCleanup {
  let removedIds = 0;
  let droppedItems = 0;

  const clean = <T extends Cited>(items: T[]): T[] =>
    items.flatMap((item) => {
      const kept = item.sourceSegmentIds.filter((id) => validSegmentIds.has(id));
      if (kept.length === 0) {
        droppedItems++;
        return [];
      }
      removedIds += item.sourceSegmentIds.length - kept.length;
      return [{ ...item, sourceSegmentIds: kept }];
    });

  return {
    analysis: {
      ...analysis,
      topics: clean(analysis.topics),
      decisions: clean(analysis.decisions),
      actionItems: clean(analysis.actionItems),
    },
    removedIds,
    droppedItems,
  };
}
