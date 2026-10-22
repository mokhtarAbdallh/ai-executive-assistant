import { describe, it, expect, vi } from "vitest";
import {
  FakeSpeechToText,
  ElevenLabsSpeechToText,
  createSpeechToText,
  normalizeCodeSwitchedText,
} from "../src/index.js";

describe("ASR Package (@dawwen/asr)", () => {
  describe("post-processor (ADR-005: English terms in Latin script)", () => {
    it("converts transliterated Arabic tech terms to canonical Latin script", () => {
      const raw = "هنبدا السبرنت ونعمل ديبلويمنت للـ الباكيند والـ الفرونتيند على البرودكشن";
      const normalized = normalizeCodeSwitchedText(raw);

      expect(normalized).toContain("backend");
      expect(normalized).toContain("frontend");
      expect(normalized).toContain("sprint");
      expect(normalized).toContain("deployment");
      expect(normalized).toContain("production");
    });

    it("normalizes common acronyms like API, PR, UI, DB", () => {
      const raw = "عملنا pr جديدة للـ api وحدثنا الـ ui";
      const normalized = normalizeCodeSwitchedText(raw);

      expect(normalized).toContain("PR");
      expect(normalized).toContain("API");
      expect(normalized).toContain("UI");
    });
  });

  describe("FakeSpeechToText (Demo Mode)", () => {
    it("returns deterministic code-switched Egyptian Arabic segments", async () => {
      const asr = new FakeSpeechToText();
      const result = await asr.transcribe(Buffer.from("dummy-audio-bytes"));

      expect(result.language).toBe("ar-EG");
      expect(result.durationSeconds).toBeGreaterThan(0);
      expect(result.segments.length).toBeGreaterThan(0);
      expect(result.text).toContain("صباح الخير يا شباب");
      expect(result.text).toContain("backend");

      // Verify diarization
      const speakers = new Set(result.segments.map((s) => s.speakerLabel));
      expect(speakers.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe("ElevenLabsSpeechToText", () => {
    it("throws if API key is empty", () => {
      expect(() => new ElevenLabsSpeechToText({ apiKey: "" })).toThrow(
        "ElevenLabsSpeechToText requires a valid apiKey",
      );
    });

    it("groups word timestamps into diarized segments with fetch mock", async () => {
      const mockResponse = {
        text: "تمام يا فندم خلصنا المهمة",
        language_code: "ar",
        words: [
          { text: "تمام", start: 0.1, end: 0.5, speaker_id: "spk-1" },
          { text: "يا", start: 0.6, end: 0.8, speaker_id: "spk-1" },
          { text: "فندم", start: 0.9, end: 1.2, speaker_id: "spk-1" },
          { text: "خلصنا", start: 1.5, end: 2.0, speaker_id: "spk-2" },
          { text: "المهمة", start: 2.1, end: 2.5, speaker_id: "spk-2" },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      try {
        const asr = new ElevenLabsSpeechToText({ apiKey: "test-elevenlabs-key" });
        const result = await asr.transcribe(Buffer.from("mock-audio"));

        expect(result.segments).toHaveLength(2);
        expect(result.segments[0]?.speakerLabel).toBe("spk-1");
        expect(result.segments[0]?.text).toBe("تمام يا فندم");
        expect(result.segments[1]?.speakerLabel).toBe("spk-2");
        expect(result.segments[1]?.text).toBe("خلصنا المهمة");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("createSpeechToText factory", () => {
    it("defaults to fake provider in demo mode", () => {
      const asr = createSpeechToText();
      expect(asr.providerName).toBe("fake");
    });
  });
});
