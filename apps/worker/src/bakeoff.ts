import {
  characterErrorRate,
  pooledRate,
  wordErrorRate,
  type ErrorRate,
  type SpeechToText,
  type TranscriptionResult,
} from "@dawwen/asr";
import type { PricingConfig } from "@dawwen/config";
import type { PreparedAudio } from "./audio.js";

/**
 * ASR bake-off (ADR-025): the same Egyptian recordings through each provider, using the
 * production path (ffmpeg prep + chunked transcription for self-hosted servers), scored
 * against human reference transcripts. Decides ElevenLabs vs QwenCleo before launch.
 */
export interface BakeoffSample {
  name: string;
  audioPath: string;
  reference: string;
}

export interface BakeoffProvider {
  name: string;
  asr: SpeechToText;
  /** Production audio prep (16 kHz WAV + chunks) for HTTP providers; absent → whole file. */
  prepare?: (path: string) => Promise<PreparedAudio>;
}

export interface BakeoffRow {
  sample: string;
  provider: string;
  wer?: ErrorRate;
  cer?: ErrorRate;
  audioSeconds?: number;
  elapsedMs: number;
  segments?: number;
  hypothesis?: string;
  error?: string;
}

export async function runBakeoff(
  samples: readonly BakeoffSample[],
  providers: readonly BakeoffProvider[],
  options: { language?: string; now?: () => number } = {},
): Promise<BakeoffRow[]> {
  const now = options.now ?? Date.now;
  const rows: BakeoffRow[] = [];
  for (const sample of samples) {
    for (const provider of providers) {
      const started = now();
      let prepared: PreparedAudio | undefined;
      try {
        prepared = provider.prepare ? await provider.prepare(sample.audioPath) : undefined;
        const opts = {
          language: options.language ?? "ar",
          diarize: true,
          audioDurationSeconds: prepared?.durationSeconds,
        };
        const result: TranscriptionResult =
          prepared?.chunks && prepared.chunks.length > 1 && provider.asr.transcribeChunked
            ? await provider.asr.transcribeChunked(prepared.chunks, opts)
            : await provider.asr.transcribe(prepared?.path ?? sample.audioPath, opts);
        rows.push({
          sample: sample.name,
          provider: provider.name,
          wer: wordErrorRate(sample.reference, result.text),
          cer: characterErrorRate(sample.reference, result.text),
          audioSeconds: prepared?.durationSeconds ?? result.durationSeconds,
          elapsedMs: now() - started,
          segments: result.segments.length,
          hypothesis: result.text,
        });
      } catch (err) {
        rows.push({
          sample: sample.name,
          provider: provider.name,
          elapsedMs: now() - started,
          error: (err as Error).message.slice(0, 300),
        });
      } finally {
        await prepared?.cleanup().catch(() => undefined);
      }
    }
  }
  return rows;
}

export interface ProviderSummary {
  provider: string;
  files: number;
  failures: number;
  /** Pooled over all words of all files. */
  wer: number;
  cer: number;
  audioMinutes: number;
  /** Processing time / audio time (lower is faster; < 1 is faster than real time). */
  realTimeFactor: number;
  /** From PRICING_CONFIG.providerCosts.asrPerAudioMinuteMicros (per started minute, like billing). */
  costPerAudioHourUsd: number | null;
}

export function summarize(rows: readonly BakeoffRow[], pricing?: PricingConfig): ProviderSummary[] {
  const providers = [...new Set(rows.map((r) => r.provider))];
  return providers.map((provider) => {
    const mine = rows.filter((r) => r.provider === provider);
    const ok = mine.filter((r) => r.wer && r.cer);
    const audioSeconds = ok.reduce((n, r) => n + (r.audioSeconds ?? 0), 0);
    const elapsedSeconds = ok.reduce((n, r) => n + r.elapsedMs / 1000, 0);
    const perMinute = pricing?.providerCosts.asrPerAudioMinuteMicros[provider];
    return {
      provider,
      files: mine.length,
      failures: mine.length - ok.length,
      wer: pooledRate(ok.map((r) => r.wer!)),
      cer: pooledRate(ok.map((r) => r.cer!)),
      audioMinutes: audioSeconds / 60,
      realTimeFactor: audioSeconds > 0 ? elapsedSeconds / audioSeconds : 0,
      costPerAudioHourUsd: perMinute === undefined ? null : (perMinute * 60) / 1_000_000,
    };
  });
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Markdown report: summary table, per-file table, then each hypothesis for manual review. */
export function renderReport(
  rows: readonly BakeoffRow[],
  summary: readonly ProviderSummary[],
): string {
  const lines = [
    "# ASR bake-off",
    "",
    "WER/CER are pooled over all reference words, after normalising Arabic spelling",
    "variants, digits and punctuation. Lower is better.",
    "",
    "| Provider | Files | Failed | WER | CER | Audio (min) | Real-time factor | Cost / audio hour |",
    "|---|---|---|---|---|---|---|---|",
    ...summary.map(
      (s) =>
        `| ${s.provider} | ${s.files} | ${s.failures} | ${pct(s.wer)} | ${pct(s.cer)} | ${s.audioMinutes.toFixed(1)} | ${s.realTimeFactor.toFixed(2)} | ${s.costPerAudioHourUsd === null ? "not in PRICING_CONFIG" : `$${s.costPerAudioHourUsd.toFixed(2)}`} |`,
    ),
    "",
    "## Per file",
    "",
    "| File | Provider | WER | CER | Sub/Del/Ins | Seconds taken | Error |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.sample} | ${r.provider} | ${r.wer ? pct(r.wer.rate) : "—"} | ${r.cer ? pct(r.cer.rate) : "—"} | ${r.wer ? `${r.wer.substitutions}/${r.wer.deletions}/${r.wer.insertions}` : "—"} | ${(r.elapsedMs / 1000).toFixed(1)} | ${r.error ? r.error.replace(/\|/g, "/") : ""} |`,
    ),
    "",
    "## Transcripts (for judging names, numbers and English terms by hand)",
  ];
  for (const r of rows.filter((x) => x.hypothesis)) {
    lines.push("", `### ${r.sample} — ${r.provider}`, "", r.hypothesis!);
  }
  return `${lines.join("\n")}\n`;
}
