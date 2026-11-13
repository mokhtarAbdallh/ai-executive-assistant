/**
 * Helpers for chunked transcription (ADR-024): bounded parallelism and removal
 * of the words that two overlapping chunks both transcribed.
 */

/**
 * Like `Promise.all(items.map(fn))` but with at most `limit` calls in flight.
 * Results keep the input order. The first rejection rejects the whole call
 * (remaining work is not started).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Comparison form of a word: no punctuation/diacritics/tatweel, case-folded. */
function normalizeWord(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/[ً-ٰٟـ]/g, "") // Arabic diacritics + tatweel
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();
}

/**
 * Removes from the start of `next` the words that repeat the end of `previous`.
 * Each chunk (except the first) starts `overlap` seconds early, so the model
 * hears whole words at the boundary; those seconds appear at the end of the
 * previous chunk's text and the start of this one. The longest suffix/prefix
 * match of up to `maxWords` words is dropped. With no match the text is kept
 * as-is: duplicating a few words is better than losing speech.
 */
export function removeOverlapPrefix(previous: string, next: string, maxWords = 12): string {
  const prevWords = previous.trim().split(/\s+/).filter(Boolean);
  const nextWords = next.trim().split(/\s+/).filter(Boolean);
  const prevNorm = prevWords.map(normalizeWord);
  const nextNorm = nextWords.map(normalizeWord);

  const max = Math.min(maxWords, prevWords.length, nextWords.length);
  for (let size = max; size >= 1; size--) {
    const tail = prevNorm.slice(prevNorm.length - size);
    const head = nextNorm.slice(0, size);
    if (tail.every((w, i) => w.length > 0 && w === head[i])) {
      // A single short word is too weak a signal (e.g. "و", "the").
      if (size === 1 && (tail[0]?.length ?? 0) < 3) break;
      return nextWords.slice(size).join(" ");
    }
  }
  return nextWords.join(" ");
}
