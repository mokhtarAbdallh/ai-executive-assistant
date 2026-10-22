import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "@dawwen/config";

describe("worker foundation", () => {
  it("loads worker config with fake provider for local testing", () => {
    const config = loadWorkerConfig({
      NODE_ENV: "test",
      AWS_REGION: "eu-central-1",
      DB_HOST: "localhost",
      DB_PORT: "5432",
      DB_NAME: "meetings",
      DB_USER: "dawwen",
      DB_PASSWORD: "secret-password",
      AUDIO_BUCKET: "bucket",
      AUDIO_QUEUE_URL: "http://localhost:4566/000000000000/queue",
      APP_SECRET: "x".repeat(32),
      ASR_PROVIDER: "fake",
      LLM_PROVIDER: "fake",
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
    });

    expect(config.asrProvider).toBe("fake");
    expect(config.audioBucket).toBe("bucket");
  });
});
