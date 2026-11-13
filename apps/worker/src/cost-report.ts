/**
 * Real cost per audio minute from usage_events (ADR-025), so the price per minute can be
 * set from data instead of guesses. Variable costs come from metering (Invariant 7);
 * fixed infrastructure (ECS, Aurora, NAT, ALB, WAF) is not metered per meeting, so it is
 * passed in from the AWS bill and spread over the period's audio minutes.
 */
export interface UsageEventLike {
  operationType: string;
  unit: string;
  quantity: number;
  costMicros: bigint;
  metadata: unknown;
}

export interface CostLine {
  operationType: string;
  events: number;
  quantity: number;
  unit: string;
  costUsd: number;
}

export interface CostReport {
  audioMinutes: number;
  meetings: number;
  lines: CostLine[];
  variableCostUsd: number;
  fixedCostUsd: number;
  revenueUsd: number;
  /** null when no audio was processed in the period. */
  variableCostPerMinuteUsd: number | null;
  totalCostPerMinuteUsd: number | null;
  revenuePerMinuteUsd: number | null;
  /** (revenue − total cost) / revenue; null without revenue. */
  grossMargin: number | null;
}

const usd = (micros: bigint | number) => Number(micros) / 1_000_000;

function customerPriceMicros(metadata: unknown): bigint {
  if (metadata && typeof metadata === "object" && "customerPriceMicros" in metadata) {
    const v = (metadata as { customerPriceMicros: unknown }).customerPriceMicros;
    if (typeof v === "string" || typeof v === "number") {
      try {
        return BigInt(v);
      } catch {
        return 0n;
      }
    }
  }
  return 0n;
}

export function buildCostReport(
  events: readonly UsageEventLike[],
  options: { fixedCostUsd?: number } = {},
): CostReport {
  const lines = new Map<string, CostLine & { micros: bigint }>();
  let audioMinutes = 0;
  let meetings = 0;
  let variableMicros = 0n;
  let revenueMicros = 0n;

  for (const ev of events) {
    const key = `${ev.operationType}|${ev.unit}`;
    const line = lines.get(key) ?? {
      operationType: ev.operationType,
      unit: ev.unit,
      events: 0,
      quantity: 0,
      costUsd: 0,
      micros: 0n,
    };
    line.events += 1;
    line.quantity += ev.quantity;
    line.micros += ev.costMicros;
    lines.set(key, line);

    variableMicros += ev.costMicros;
    if (ev.operationType === "AUDIO_TRANSCRIPTION" && ev.unit === "minutes") {
      audioMinutes += ev.quantity;
      meetings += 1;
      revenueMicros += customerPriceMicros(ev.metadata);
    }
  }

  const fixedCostUsd = options.fixedCostUsd ?? 0;
  const variableCostUsd = usd(variableMicros);
  const revenueUsd = usd(revenueMicros);
  const total = variableCostUsd + fixedCostUsd;
  const perMinute = (x: number) => (audioMinutes > 0 ? x / audioMinutes : null);

  return {
    audioMinutes,
    meetings,
    lines: [...lines.values()]
      .map(({ micros, ...l }) => ({ ...l, costUsd: usd(micros) }))
      .sort((a, b) => b.costUsd - a.costUsd),
    variableCostUsd,
    fixedCostUsd,
    revenueUsd,
    variableCostPerMinuteUsd: perMinute(variableCostUsd),
    totalCostPerMinuteUsd: perMinute(total),
    revenuePerMinuteUsd: perMinute(revenueUsd),
    grossMargin: revenueUsd > 0 ? (revenueUsd - total) / revenueUsd : null,
  };
}

const money = (x: number | null, digits = 4) => (x === null ? "—" : `$${x.toFixed(digits)}`);

export function renderCostReport(report: CostReport, period: { from: Date; to: Date }): string {
  return [
    `# Cost per audio minute — ${period.from.toISOString().slice(0, 10)} → ${period.to.toISOString().slice(0, 10)}`,
    "",
    `Meetings: ${report.meetings} · billed audio minutes: ${report.audioMinutes}`,
    "",
    "| Operation | Events | Quantity | Cost |",
    "|---|---|---|---|",
    ...report.lines.map(
      (l) =>
        `| ${l.operationType} | ${l.events} | ${Math.round(l.quantity)} ${l.unit} | ${money(l.costUsd, 2)} |`,
    ),
    `| Fixed infrastructure (from the AWS bill) | | | ${money(report.fixedCostUsd, 2)} |`,
    "",
    "| Per audio minute | USD |",
    "|---|---|",
    `| Variable cost (ASR + LLM + embeddings + chat) | ${money(report.variableCostPerMinuteUsd)} |`,
    `| Total cost incl. fixed | ${money(report.totalCostPerMinuteUsd)} |`,
    `| Revenue (customer price charged) | ${money(report.revenuePerMinuteUsd)} |`,
    `| Gross margin | ${report.grossMargin === null ? "—" : `${(report.grossMargin * 100).toFixed(1)}%`} |`,
    "",
    "Provider costs are what PRICING_CONFIG says they are: compare the variable total with",
    "the Bedrock / ElevenLabs invoices for the same period before trusting the margin.",
    "",
  ].join("\n");
}
