/**
 * ASR bake-off runner (ADR-025). Costs money: every file is sent to every provider.
 *
 *   pnpm --filter @dawwen/worker bakeoff --dir ./recordings --providers elevenlabs,qwencleo-http
 *
 * --dir    folder with pairs: <name>.(wav|mp3|m4a|ogg|webm) + <name>.txt (human reference transcript)
 * --out    output folder (default ./bakeoff-results, git-ignored): report.md + results.json
 *
 * Credentials come from the environment / .env like the worker: ASR_API_KEY (ElevenLabs),
 * ASR_HTTP_URL + ASR_HTTP_API_KEY (QwenCleo), PRICING_CONFIG for the cost column.
 * The report contains transcripts: keep it private (Invariant 5), never commit it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createSpeechToText } from "@dawwen/asr";
import { loadDotEnvForDev, parsePricingConfig, type PricingConfig } from "@dawwen/config";
import { prepareAudioForAsr } from "../src/audio.js";
import {
  renderReport,
  runBakeoff,
  summarize,
  type BakeoffProvider,
  type BakeoffSample,
} from "../src/bakeoff.js";

const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac"]);
const log = { warn: (m: string) => console.warn(m), info: () => undefined };

function samplesIn(dir: string): BakeoffSample[] {
  return readdirSync(dir)
    .filter((f) => AUDIO_EXT.has(extname(f).toLowerCase()))
    .sort()
    .flatMap((file) => {
      const name = basename(file, extname(file));
      const refPath = join(dir, `${name}.txt`);
      if (!existsSync(refPath)) {
        console.warn(`skipping ${file}: no ${name}.txt reference`);
        return [];
      }
      return [{ name, audioPath: join(dir, file), reference: readFileSync(refPath, "utf8") }];
    });
}

function provider(name: string): BakeoffProvider {
  const http = name.endsWith("-http");
  return {
    name,
    asr: createSpeechToText({
      provider: name,
      elevenlabs: { apiKey: process.env.ASR_API_KEY || process.env.ELEVENLABS_API_KEY || "" },
      http: { baseUrl: process.env.ASR_HTTP_URL || "", apiKey: process.env.ASR_HTTP_API_KEY },
    }),
    // Same preparation as production (main.ts): 16 kHz WAV + overlapping 20 s chunks.
    prepare: http
      ? (path) => prepareAudioForAsr(path, { chunkSeconds: 20, overlapSeconds: 2, log })
      : undefined,
  };
}

async function main(): Promise<void> {
  loadDotEnvForDev();
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      providers: { type: "string", default: "elevenlabs,qwencleo-http" },
      out: { type: "string", default: "bakeoff-results" },
      language: { type: "string", default: "ar" },
    },
  });
  if (!values.dir) {
    console.error("usage: bakeoff --dir <recordings> [--providers a,b] [--out dir]");
    process.exit(2);
  }

  const samples = samplesIn(resolve(values.dir));
  const providers = values.providers.split(",").map((p) => provider(p.trim()));
  console.log(`${samples.length} recordings × ${providers.length} providers`);

  let pricing: PricingConfig | undefined;
  if (process.env.PRICING_CONFIG) pricing = parsePricingConfig(process.env.PRICING_CONFIG);

  const rows = await runBakeoff(samples, providers, { language: values.language });
  const summary = summarize(rows, pricing);

  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.md"), renderReport(rows, summary));
  writeFileSync(
    join(out, "results.json"),
    JSON.stringify({ summary, rows: rows.map(({ hypothesis: _h, ...r }) => r) }, null, 2),
  );
  for (const s of summary) {
    console.log(`${s.provider}: WER ${(s.wer * 100).toFixed(1)}% · ${s.failures} failed`);
  }
  console.log(`report: ${join(out, "report.md")}`);
}

void main();
