import { describe, expect, it } from "vitest";
import { MeetingAnalysisSchema, type MeetingAnalysis } from "../src/index.js";

function validAnalysis(): MeetingAnalysis {
  return {
    meta: { date: "2026-10-22", time: "10:30", language: "mixed", participants: ["أحمد", "Sara"] },
    tldr: "اتفقنا نطلق الـ beta يوم الأحد الجاي.",
    purpose: "مراجعة خطة الإطلاق",
    agenda: ["الـ roadmap"],
    topics: [
      { title: "Launch", summary: "مناقشة ميعاد الإطلاق", sourceTs: "01:10", sourceSegmentIds: ["s1"] },
    ],
    decisions: [
      {
        text: "الإطلاق يوم الأحد",
        sourceTs: "02:05",
        sourceSegmentIds: ["s2", "s3"],
        needsReview: false,
      },
    ],
    actionItems: [
      {
        task: "يجهز الـ release notes",
        owner: "أحمد",
        due: "2026-10-25",
        priority: "high",
        sourceTs: "03:40",
        sourceSegmentIds: ["s4"],
        needsReview: false,
      },
    ],
    openQuestions: [],
    nextMeeting: {
      proposedDatetime: "2026-10-29T10:00:00+03:00",
      place: null,
      status: "pending_confirmation",
    },
    documents: [],
  };
}

describe("MeetingAnalysisSchema", () => {
  it("accepts a valid bilingual analysis", () => {
    expect(MeetingAnalysisSchema.parse(validAnalysis())).toBeTruthy();
  });

  describe("Invariant 2 — every decision/task carries a source", () => {
    it("rejects a decision without segment ids", () => {
      const a = validAnalysis();
      a.decisions[0]!.sourceSegmentIds = [];
      expect(MeetingAnalysisSchema.safeParse(a).success).toBe(false);
    });

    it("rejects an action item without sourceTs", () => {
      const a = validAnalysis() as unknown as { actionItems: Record<string, unknown>[] };
      delete a.actionItems[0]!.sourceTs;
      expect(MeetingAnalysisSchema.safeParse(a).success).toBe(false);
    });

    it("rejects malformed timestamps", () => {
      const a = validAnalysis();
      a.topics[0]!.sourceTs = "about a minute in";
      expect(MeetingAnalysisSchema.safeParse(a).success).toBe(false);
    });
  });

  describe("Invariant 3 — no fabrication", () => {
    it("accepts unknown owner/due when flagged needsReview", () => {
      const a = validAnalysis();
      a.actionItems[0] = { ...a.actionItems[0]!, owner: null, due: null, needsReview: true };
      expect(MeetingAnalysisSchema.safeParse(a).success).toBe(true);
    });

    it("rejects unknown owner that is not flagged needsReview", () => {
      const a = validAnalysis();
      a.actionItems[0] = { ...a.actionItems[0]!, owner: null, needsReview: false };
      expect(MeetingAnalysisSchema.safeParse(a).success).toBe(false);
    });

    it("rejects unknown due date that is not flagged needsReview", () => {
      const a = validAnalysis();
      a.actionItems[0] = { ...a.actionItems[0]!, due: null, needsReview: false };
      expect(MeetingAnalysisSchema.safeParse(a).success).toBe(false);
    });
  });

  describe("Invariant 1 — analysis can only propose the next meeting", () => {
    it("rejects a next meeting marked as booked", () => {
      const a = validAnalysis() as unknown as { nextMeeting: { status: string } };
      a.nextMeeting.status = "booked";
      expect(MeetingAnalysisSchema.safeParse(a).success).toBe(false);
    });
  });

  it("rejects unknown keys (strict contract)", () => {
    const a = { ...validAnalysis(), extra: true };
    expect(MeetingAnalysisSchema.safeParse(a).success).toBe(false);
  });
});
