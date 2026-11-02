import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
  ConfigError,
  isHttpAsrProvider,
  loadDotEnvForDev,
  loadWorkerConfig,
  type WorkerConfig,
} from "@dawwen/config";
import { getPrismaClient } from "@dawwen/db";
import { createSpeechToText } from "@dawwen/asr";
import { createLlmClient } from "@dawwen/llm";
import { prepareAudioForAsr } from "./audio.js";
import { SqsAudioConsumer } from "./consumer.js";

function readConfig(): WorkerConfig {
  loadDotEnvForDev();
  try {
    return loadWorkerConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

interface AsrHttpOptions {
  chunkSeconds: number;
  timeoutMs: number;
}

const DEFAULT_ASR_HTTP_OPTIONS: AsrHttpOptions = {
  chunkSeconds: 20, // matches the upstream qwencleo-asr chunked transcription
  timeoutMs: 600_000,
};

function parseAsrHttpOptions(raw: string | undefined, log: {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}): AsrHttpOptions {
  if (!raw) return DEFAULT_ASR_HTTP_OPTIONS;
  try {
    const parsed = JSON.parse(raw) as Partial<AsrHttpOptions>;
    const chunkSeconds =
      typeof parsed.chunkSeconds === "number" && parsed.chunkSeconds >= 5 && parsed.chunkSeconds <= 120
        ? Math.round(parsed.chunkSeconds)
        : DEFAULT_ASR_HTTP_OPTIONS.chunkSeconds;
    const timeoutMs =
      typeof parsed.timeoutMs === "number" && parsed.timeoutMs >= 5_000 && parsed.timeoutMs <= 3_600_000
        ? Math.round(parsed.timeoutMs)
        : DEFAULT_ASR_HTTP_OPTIONS.timeoutMs;
    return { chunkSeconds, timeoutMs };
  } catch {
    log.warn("ASR_HTTP_OPTIONS is not valid JSON; using defaults");
    return DEFAULT_ASR_HTTP_OPTIONS;
  }
}

async function main(): Promise<void> {
  const config = readConfig();

  // Structured logger pattern (no raw secret logging)
  const log = {
    info: (msg: string, meta?: Record<string, unknown>) => {
      process.stdout.write(
        JSON.stringify({ level: "info", time: new Date().toISOString(), msg, ...meta }) + "\n",
      );
    },
    warn: (msg: string, meta?: Record<string, unknown>) => {
      process.stdout.write(
        JSON.stringify({ level: "warn", time: new Date().toISOString(), msg, ...meta }) + "\n",
      );
    },
    error: (msg: string, meta?: Record<string, unknown>) => {
      console.error(
        JSON.stringify({ level: "error", time: new Date().toISOString(), msg, ...meta }),
      );
    },
  };

  log.info("worker daemon started", {
    env: config.env,
    asrProvider: config.asrProvider,
    llmProvider: config.llmProvider,
    queueUrl: config.audioQueueUrl,
    bucket: config.audioBucket,
  });

  const prisma = getPrismaClient();

  const s3Client = new S3Client({
    region: config.awsRegion,
    endpoint: process.env.AWS_ENDPOINT_URL,
    forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL),
  });

  const sqsClient = new SQSClient({
    region: config.awsRegion,
    endpoint: process.env.AWS_ENDPOINT_URL,
  });

  const llmClient = createLlmClient({
    provider: config.llmProvider,
    bedrock: {
      region: config.awsRegion,
      endpointUrl: config.awsEndpointUrl,
      modelId: config.bedrock.modelId,
    },
  });

  // Free-form knobs for the self-hosted ASR adapter (ASR_HTTP_OPTIONS JSON, ADR-018).
  const asrHttpOptions = parseAsrHttpOptions(config.asrHttpOptionsJson, log);
  const asrClient = createSpeechToText({
    provider: config.asrProvider,
    elevenlabs: config.asrApiKey ? { apiKey: config.asrApiKey } : undefined,
    http: {
      baseUrl: config.asrHttpUrl || "",
      apiKey: config.asrHttpApiKey,
      timeoutMs: asrHttpOptions.timeoutMs,
    },
  });

  const consumer = new SqsAudioConsumer(
    sqsClient,
    config.audioQueueUrl,
    {
      prisma,
      s3Client,
      asrClient,
      llmClient,
      pricingConfig: config.pricing,
      asrProviderName: config.asrProvider,
      llmProviderName: config.llmProvider,
      // Self-hosted ASR providers need 16 kHz mono WAV + chunked audio for real
      // timestamps (ADR-018). Whole-format providers keep the original bytes.
      prepareAsrAudio: isHttpAsrProvider(config.asrProvider)
        ? (input) =>
            prepareAudioForAsr(input, {
              chunkSeconds: asrHttpOptions.chunkSeconds,
              log,
            })
        : undefined,
      logger: log,
    },
    log,
  );

  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info(`received ${signal}, shutting down worker`);
    consumer.stop();
    await prisma.$disconnect();
    setTimeout(() => process.exit(0), 1000);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Start polling
  await consumer.startPolling(1000);
}

void main();

