/**
 * Transcription accuracy metrics for the ASR bake-off (ADR-025).
 *
 * Text is normalised before scoring so that spelling variants that do not change meaning
 * are not counted as errors: Arabic diacritics/tatweel, hamza forms of alef, ى/ي, ة/ه,
 * punctuation and Latin case. English words are kept (code-switched meetings).
 */
export function normalizeForScoring(text: string): string[] {
  return text
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface EditCounts {
  substitutions: number;
  deletions: number;
  insertions: number;
  /** Length of the reference sequence. */
  referenceLength: number;
}

/** Levenshtein alignment counts between two token sequences (O(n·m) time, O(m) memory). */
export function editCounts<T>(reference: readonly T[], hypothesis: readonly T[]): EditCounts {
  type Cell = { cost: number; s: number; d: number; i: number };
  let prev: Cell[] = Array.from({ length: hypothesis.length + 1 }, (_, j) => ({
    cost: j,
    s: 0,
    d: 0,
    i: j,
  }));
  for (let r = 1; r <= reference.length; r++) {
    const row: Cell[] = [{ cost: r, s: 0, d: r, i: 0 }];
    for (let h = 1; h <= hypothesis.length; h++) {
      const same = reference[r - 1] === hypothesis[h - 1];
      const diag = prev[h - 1]!;
      const up = prev[h]!;
      const left = row[h - 1]!;
      const options: Cell[] = [
        { ...diag, cost: diag.cost + (same ? 0 : 1), s: diag.s + (same ? 0 : 1) },
        { ...up, cost: up.cost + 1, d: up.d + 1 },
        { ...left, cost: left.cost + 1, i: left.i + 1 },
      ];
      row.push(options.reduce((best, o) => (o.cost < best.cost ? o : best)));
    }
    prev = row;
  }
  const last = prev[hypothesis.length]!;
  return {
    substitutions: last.s,
    deletions: last.d,
    insertions: last.i,
    referenceLength: reference.length,
  };
}

export interface ErrorRate extends EditCounts {
  /** (S + D + I) / N; can exceed 1 with many insertions. */
  rate: number;
}

function toRate(counts: EditCounts): ErrorRate {
  const errors = counts.substitutions + counts.deletions + counts.insertions;
  return {
    ...counts,
    rate: counts.referenceLength === 0 ? (errors === 0 ? 0 : 1) : errors / counts.referenceLength,
  };
}

/** Word error rate on normalised words. */
export function wordErrorRate(reference: string, hypothesis: string): ErrorRate {
  return toRate(editCounts(normalizeForScoring(reference), normalizeForScoring(hypothesis)));
}

/** Character error rate (spaces removed), less sensitive to word-splitting differences. */
export function characterErrorRate(reference: string, hypothesis: string): ErrorRate {
  const chars = (t: string) => [...normalizeForScoring(t).join("")];
  return toRate(editCounts(chars(reference), chars(hypothesis)));
}

/** Corpus WER: total errors over total reference words (not the mean of per-file rates). */
export function pooledRate(rates: readonly EditCounts[]): number {
  const errors = rates.reduce((n, r) => n + r.substitutions + r.deletions + r.insertions, 0);
  const words = rates.reduce((n, r) => n + r.referenceLength, 0);
  return words === 0 ? 0 : errors / words;
}
