#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { ElevenLabsSpeechToText } from "../src/adapters/elevenlabs.js";
import { standardizeArabicTerms } from "../src/post-processor.js";

interface CliArgs {
  apiKey?: string;
  filePath?: string;
  help?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--key" || arg === "-k") {
      result.apiKey = args[++i];
    } else if (arg === "--file" || arg === "-f") {
      result.filePath = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    }
  }
  return result;
}

function printUsage(): void {
  console.log(`
======================================================
  Dawwen (دوّن) — ElevenLabs Real Transcription Tool
======================================================

Usage:
  pnpm --filter @dawwen/asr exec tsx scripts/try-elevenlabs.ts --key <API_KEY> --file <PATH_TO_AUDIO>

Options:
  --key,  -k   ElevenLabs API Key (or set ELEVENLABS_API_KEY env var)
  --file, -f   Path to audio file (mp3, wav, m4a, ogg, webm)
  --help, -h   Show this help message

Example:
  pnpm --filter @dawwen/asr exec tsx scripts/try-elevenlabs.ts \\
    --key xi-api-key-12345 \\
    --file ./samples/meeting_eg_en.mp3
`);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const apiKey = args.apiKey || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("❌ Error: ElevenLabs API Key is required.");
    console.error("Pass --key <KEY> or set the ELEVENLABS_API_KEY environment variable.\n");
    printUsage();
    process.exit(1);
  }

  const filePath = args.filePath;
  if (!filePath) {
    console.error("❌ Error: Audio file path is required.");
    console.error("Pass --file <PATH> to an audio file.\n");
    printUsage();
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Error: Audio file not found at path: ${resolvedPath}`);
    process.exit(1);
  }

  const fileStats = fs.statSync(resolvedPath);
  console.log(`\n🎧 Loading audio file: ${resolvedPath}`);
  console.log(`📦 Size: ${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`);

  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeTypeMap: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
  };
  const mimeType = mimeTypeMap[ext] || "audio/mpeg";

  const audioBuffer = fs.readFileSync(resolvedPath);

  console.log("🚀 Initializing ElevenLabs Scribe v2 client...");
  const asr = new ElevenLabsSpeechToText({ apiKey });

  console.log("⏳ Uploading and transcribing audio with speaker diarization...");
  const startTime = Date.now();

  try {
    const result = await asr.transcribe(audioBuffer, {
      fileName: path.basename(resolvedPath),
      mimeType,
      diarize: true,
      languageHint: "auto",
    });

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Transcription complete in ${elapsedSeconds}s!`);
    console.log(`🌐 Language detected: ${result.languageDetected || "auto"}`);
    if (result.durationSeconds) {
      console.log(`⏱️ Audio duration: ${result.durationSeconds.toFixed(1)} seconds`);
    }
    console.log(`🗣️ Segments count: ${result.segments.length}\n`);

    console.log("---------------- TRANSCRIPT SEGMENTS ----------------");
    for (const seg of result.segments) {
      const startSec = (seg.startMs / 1000).toFixed(1);
      const endSec = (seg.endMs / 1000).toFixed(1);
      const speaker = seg.speaker || "Speaker";
      const standardized = standardizeArabicTerms(seg.text);

      console.log(`[${startSec}s - ${endSec}s] ${speaker}:`);
      console.log(`   ${standardized}\n`);
    }

    console.log("---------------- FULL TEXT ----------------");
    console.log(standardizeArabicTerms(result.text));
    console.log("-------------------------------------------\n");
  } catch (err: any) {
    console.error("❌ Transcription failed:", err.message);
    process.exit(1);
  }
}

void run();
