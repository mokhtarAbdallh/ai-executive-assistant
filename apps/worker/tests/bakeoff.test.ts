import { describe, expect, it, vi } from "vitest";
import type { SpeechToText } from "@dawwen/asr";
import { renderReport, runBakeoff, summarize } from "../src/bakeoff.js";

const result = (text: string) => ({
  text,
  language: "ar",
  durationSeconds: 60,
  segments: [{ speakerLabel: "S1", startMs: 0, endMs: 60_000, text }],
});

describe("ASR bake-off (ADR-025)", () => {
  const samples = [
    { name: "m1", audioPath: "/r/m1.wav", reference: "هنسلم الـ API يوم الخميس" },
    { name: "m2", audioPath: "/r/m2.wav", reference: "سارة هتبعت التصميم" },
  ];
  const perfect: SpeechToText = {
    providerName: "a",
    transcribe: vi.fn(async (path) =>
      result(path === "/r/m1.wav" ? "هنسلم الـ API يوم الخميس" : "ساره هتبعت التصميم"),
    ),
  };
  const sloppy: SpeechToText = {
    providerName: "b",
    transcribe: vi.fn(async (path) => {
      if (path === "/r/m2.wav") throw new Error("HTTP 500");
      return result("هنسلم API يوم الاربع");
    }),
  };

  it("scores every file per provider and keeps failures as rows", async () => {
    let t = 0;
    const rows = await runBakeoff(
      samples,
      [
        { name: "a", asr: perfect },
        { name: "b", asr: sloppy },
      ],
      { now: () => (t += 1000) },
    );

    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.sample === "m2" && r.provider === "a")?.wer?.rate).toBe(0); // ة/ه
    expect(rows.find((r) => r.sample === "m1" && r.provider === "b")?.wer?.rate).toBeCloseTo(0.4);
    expect(rows.find((r) => r.sample === "m2" && r.provider === "b")?.error).toBe("HTTP 500");
  });

  it("uses chunked transcription and cleans up when the provider prepares audio", async () => {
    const cleanup = vi.fn(async () => undefined);
    const transcribeChunked = vi.fn(async () => result("هنسلم الـ API يوم الخميس"));
    const asr: SpeechToText = { providerName: "q", transcribe: vi.fn(), transcribeChunked };

    const rows = await runBakeoff(
      [samples[0]!],
      [
        {
          name: "qwencleo-http",
          asr,
          prepare: async () => ({
            path: "/tmp/a.wav",
            durationSeconds: 45,
            chunks: [
              { path: "/tmp/0.wav", startMs: 0, endMs: 20_000 },
              { path: "/tmp/1.wav", startMs: 20_000, endMs: 45_000, leadInMs: 2000 },
            ],
            cleanup,
          }),
        },
      ],
    );

    expect(transcribeChunked).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(rows[0]).toMatchObject({ audioSeconds: 45 });
  });

  it("summarises pooled WER, failures and cost per audio hour", async () => {
    const rows = await runBakeoff(samples, [{ name: "elevenlabs", asr: perfect }]);
    const [summary] = summarize(rows, {
      customerPricePerAudioMinuteMicros: 0,
      lowBalanceThresholdMicros: 0,
      providerCosts: {
        asrPerAudioMinuteMicros: { elevenlabs: 3667 },
        llmPerMillionInputTokensMicros: {},
        llmPerMillionOutputTokensMicros: {},
        embeddingsPerMillionTokensMicros: {},
      },
    });

    expect(summary).toMatchObject({ provider: "elevenlabs", files: 2, failures: 0, wer: 0 });
    expect(summary!.costPerAudioHourUsd).toBeCloseTo(0.22, 2);
    const report = renderReport(rows, [summary!]);
    expect(report).toContain("| elevenlabs | 2 | 0 | 0.0% |");
    expect(report).toContain("### m1 — elevenlabs");
  });
});
