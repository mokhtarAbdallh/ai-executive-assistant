import { describe, expect, it } from "vitest";
import { buildCostReport, renderCostReport } from "../src/cost-report.js";

describe("cost per audio minute (ADR-025)", () => {
  const events = [
    {
      operationType: "AUDIO_TRANSCRIPTION",
      unit: "minutes",
      quantity: 60,
      costMicros: 72_000n,
      metadata: { provider: "qwencleo-http", customerPriceMicros: "1800000" },
    },
    {
      operationType: "AUDIO_TRANSCRIPTION",
      unit: "minutes",
      quantity: 40,
      costMicros: 48_000n,
      metadata: { provider: "qwencleo-http", customerPriceMicros: "1200000" },
    },
    {
      operationType: "LLM_ANALYSIS",
      unit: "tokens",
      quantity: 50_000,
      costMicros: 330_000n,
      metadata: null,
    },
    {
      operationType: "LLM_CHAT",
      unit: "tokens",
      quantity: 10_000,
      costMicros: 50_000n,
      metadata: {},
    },
  ];

  it("divides metered and fixed cost by billed audio minutes", () => {
    const r = buildCostReport(events, { fixedCostUsd: 1 });

    expect(r).toMatchObject({ audioMinutes: 100, meetings: 2, revenueUsd: 3 });
    expect(r.variableCostUsd).toBeCloseTo(0.5);
    expect(r.variableCostPerMinuteUsd).toBeCloseTo(0.005);
    expect(r.totalCostPerMinuteUsd).toBeCloseTo(0.015);
    expect(r.revenuePerMinuteUsd).toBeCloseTo(0.03);
    expect(r.grossMargin).toBeCloseTo(0.5);
    expect(r.lines[0]).toMatchObject({ operationType: "LLM_ANALYSIS", events: 1 });
  });

  it("has no per-minute figures without audio, and tolerates bad metadata", () => {
    const r = buildCostReport([
      { operationType: "LLM_CHAT", unit: "tokens", quantity: 1, costMicros: 10n, metadata: "x" },
      {
        operationType: "AUDIO_TRANSCRIPTION",
        unit: "minutes",
        quantity: 0,
        costMicros: 0n,
        metadata: { customerPriceMicros: "not-a-number" },
      },
    ]);
    expect(r.variableCostPerMinuteUsd).toBeNull();
    expect(r.grossMargin).toBeNull();
    const md = renderCostReport(r, { from: new Date("2026-11-01"), to: new Date("2026-12-01") });
    expect(md).toContain("2026-11-01 → 2026-12-01");
    expect(md).toContain("| Gross margin | — |");
  });
});
