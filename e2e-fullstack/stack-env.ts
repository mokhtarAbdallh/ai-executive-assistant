/**
 * Environment for the full-stack E2E run (ADR-025): the API, worker and web talk to the
 * docker-compose stack (Postgres + LocalStack) with the fake ASR/LLM providers.
 * Values are the local compose defaults (docker-compose.yml) — never real credentials.
 * Override the host ports with DAWWEN_PG_PORT / DAWWEN_LOCALSTACK_PORT like compose.
 */
const pgPort = process.env.DAWWEN_PG_PORT ?? "5432";
const awsEndpoint = `http://127.0.0.1:${process.env.DAWWEN_LOCALSTACK_PORT ?? "4566"}`;

export const WEB_PORT = 5176;
export const API_URL = "http://127.0.0.1:8080";

export const STACK_ENV: Record<string, string> = {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: pgPort,
  DB_NAME: "meetings",
  DB_USER: "dawwen",
  DB_PASSWORD: "dawwen_dev_pw",
  AWS_REGION: "eu-central-1",
  AWS_ENDPOINT_URL: awsEndpoint,
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  AUDIO_BUCKET: "meeting-assistant-audio",
  AUDIO_QUEUE_URL: `${awsEndpoint}/000000000000/meeting-assistant-audio-processing`,
  APP_SECRET: "e2e-local-only-secret-0123456789abcdef0123456789",
  AUTH_PROVIDER: "local",
  ASR_PROVIDER: "fake",
  LLM_PROVIDER: "fake",
  DEMO_MODE: "false",
  PUBLIC_BASE_URL: `http://localhost:${WEB_PORT}`,
  CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
  PRICING_CONFIG: JSON.stringify({
    customerPricePerAudioMinuteMicros: 20000,
    providerCosts: {
      asrPerAudioMinuteMicros: { fake: 0 },
      llmPerMillionInputTokensMicros: { fake: 0 },
      llmPerMillionOutputTokensMicros: { fake: 0 },
      embeddingsPerMillionTokensMicros: { fake: 0 },
    },
    lowBalanceThresholdMicros: 1000000,
  }),
};

export const DATABASE_URL = `postgresql://dawwen:dawwen_dev_pw@127.0.0.1:${pgPort}/meetings`;
