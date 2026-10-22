import { describe, it, expect, vi } from "vitest";
import {
  FakeLlmClient,
  BedrockLlmClient,
  createLlmClient,
  type TranscriptContext,
} from "../src/index.js";
import { MeetingAnalysisSchema } from "@dawwen/shared";

describe("LLM Package (@dawwen/llm)", () => {
  const sampleContext: TranscriptContext = {
    meetingTitle: "Sprint Review",
    language: "ar-EG",
    participants: ["أحمد", "سارة", "عمر"],
    segments: [
      {
        id: "seg-101",
        speakerLabel: "أحمد",
        startMs: 0,
        endMs: 5000,
        text: "هنبدأ بمراجعة المهام",
      },
      {
        id: "seg-102",
        speakerLabel: "سارة",
        startMs: 5200,
        endMs: 12000,
        text: "خلصت الـ Auth API بالكامل",
      },
    ],
  };

  describe("FakeLlmClient (Demo Mode)", () => {
    it("returns valid analysis adhering strictly to MeetingAnalysisSchema", async () => {
      const llm = new FakeLlmClient();
      const result = await llm.analyzeMeeting(sampleContext);

      expect(result.modelName).toBe("fake-claude-3-5-sonnet");
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);

      // Verify schema adherence
      const parsed = MeetingAnalysisSchema.safeParse(result.analysis);
      expect(parsed.success).toBe(true);

      // Verify citations use input segment IDs (Invariant 2)
      expect(result.analysis.topics.length).toBeGreaterThan(0);
      expect(result.analysis.topics[0]?.sourceSegmentIds).toContain("seg-102");
    });

    it("leaves unknown owner/due as null and sets needsReview: true (Invariant 3)", async () => {
      const llm = new FakeLlmClient();
      const result = await llm.analyzeMeeting(sampleContext);

      const unassignedTask = result.analysis.actionItems.find((t) => t.owner === null);
      expect(unassignedTask).toBeDefined();
      expect(unassignedTask?.needsReview).toBe(true);
      expect(unassignedTask?.due).toBeNull();
    });
  });

  describe("BedrockLlmClient helpers", () => {
    it("cleans markdown fences from JSON output", () => {
      const client = new BedrockLlmClient();
      const fenced = '```json\n{"test": true}\n```';
      expect(client.cleanJsonText(fenced)).toBe('{"test": true}');
    });

    it("wraps transcript segments with XML tags in user prompt", () => {
      const client = new BedrockLlmClient();
      const prompt = client.buildUserMessage(sampleContext);

      expect(prompt).toContain('<segment id="seg-101"');
      expect(prompt).toContain('<segment id="seg-102"');
      expect(prompt).toContain("<transcript>");
    });
  });

  describe("Bedrock repair-retry loop", () => {
    it("recovers from invalid initial JSON by sending validation feedback", async () => {
      const client = new BedrockLlmClient({ maxRetries: 3 });

      const invalidOutput = '{"tldr": "Incomplete json without required fields"}';
      const validRepairedOutput = JSON.stringify({
        meta: {
          date: "2026-10-22",
          time: "10:00",
          language: "ar",
          participants: ["أحمد"],
        },
        tldr: "ملخص سريع للاجتماع مع حسم القرارات الرئيسية.",
        purpose: "المراجعة الأسبوعية",
        agenda: ["الأجندة الأولى"],
        topics: [
          {
            title: "الموضوع الأول",
            summary: "ملخص النقاش",
            sourceTs: "00:05",
            sourceSegmentIds: ["seg-101"],
          },
        ],
        decisions: [
          {
            text: "تم الاتفاق على النشر يوم الخميس",
            sourceTs: "00:05",
            sourceSegmentIds: ["seg-101"],
            needsReview: false,
          },
        ],
        actionItems: [
          {
            task: "مراجعة الـ PR",
            owner: "أحمد",
            due: "2026-10-24",
            priority: "high",
            sourceTs: "00:05",
            sourceSegmentIds: ["seg-101"],
            needsReview: false,
          },
        ],
        openQuestions: [],
        nextMeeting: {
          proposedDatetime: "2026-10-25T10:00:00Z",
          place: "Meet",
          status: "pending_confirmation",
        },
        documents: [],
      });

      let callCount = 0;
      // Mock client.send
      (client as any).client = {
        send: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              output: {
                message: {
                  content: [{ text: invalidOutput }],
                },
              },
              usage: { inputTokens: 500, outputTokens: 50 },
            };
          }
          return {
            output: {
              message: {
                content: [{ text: validRepairedOutput }],
              },
            },
            usage: { inputTokens: 600, outputTokens: 250 },
          };
        }),
      };

      const result = await client.analyzeMeeting(sampleContext);

      expect(callCount).toBe(2); // Needed 2 attempts (1 initial failure + 1 repair)
      expect(result.inputTokens).toBe(1100);
      expect(result.outputTokens).toBe(300);
      expect(result.analysis.purpose).toBe("المراجعة الأسبوعية");
    });
  });

  describe("createLlmClient factory", () => {
    it("defaults to fake provider in demo mode", () => {
      const llm = createLlmClient();
      expect(llm.providerName).toBe("fake");
    });
  });
});
