import { describe, expect, it } from "vitest";
import {
  characterErrorRate,
  editCounts,
  normalizeForScoring,
  pooledRate,
  wordErrorRate,
} from "../src/index.js";

describe("ASR bake-off metrics (ADR-025)", () => {
  it("normalises Arabic spelling variants, digits, punctuation and case", () => {
    expect(normalizeForScoring("إتفقنا، على الـ Release يوم ٢٠ ؟")).toEqual(
      normalizeForScoring("اتفقنا على الـ release يوم 20"),
    );
    expect(normalizeForScoring("مدرسةٌ كبرى")).toEqual(["مدرسه", "كبري"]);
  });

  it("counts substitutions, deletions and insertions", () => {
    expect(editCounts(["a", "b", "c"], ["a", "x", "c", "d"])).toEqual({
      substitutions: 1,
      deletions: 0,
      insertions: 1,
      referenceLength: 3,
    });
    expect(editCounts(["a", "b", "c"], ["a"])).toMatchObject({ deletions: 2, substitutions: 0 });
  });

  it("computes WER and CER", () => {
    expect(wordErrorRate("هنسلم الـ API يوم الخميس", "هنسلم الـ API يوم الخميس").rate).toBe(0);
    expect(wordErrorRate("هنسلم الـ API يوم الخميس", "هنسلم API يوم الاربع").rate).toBeCloseTo(0.4);
    expect(characterErrorRate("الخميس", "الخميص").rate).toBeCloseTo(1 / 6);
    expect(wordErrorRate("", "").rate).toBe(0);
  });

  it("pools WER over the corpus (long files weigh more)", () => {
    const short = { substitutions: 1, deletions: 0, insertions: 0, referenceLength: 2 };
    const long = { substitutions: 1, deletions: 0, insertions: 0, referenceLength: 98 };
    expect(pooledRate([short, long])).toBeCloseTo(0.02);
  });
});
