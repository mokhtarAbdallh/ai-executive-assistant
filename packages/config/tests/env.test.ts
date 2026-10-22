import { describe, expect, it } from "vitest";
import { buildDatabaseUrl, ConfigError, loadApiConfig, loadWorkerConfig } from "../src/index.js";

const pricing = JSON.stringify({
  customerPricePerAudioMinuteMicros: 20000,
  providerCosts: {
    asrPerAudioMinuteMicros: { fake: 0 },
    llmPerMillionInputTokensMicros: { fake: 0 },
    llmPerMillionOutputTokensMicros: { fake: 0 },
    embeddingsPerMillionTokensMicros: { fake: 0 },
  },
  lowBalanceThresholdMicros: 1000000,
});

const baseEnv = {
  NODE_ENV: "test",
  AWS_REGION: "eu-central-1",
  DB_HOST: "localhost",
  DB_PORT: "5432",
  DB_NAME: "meetings",
  DB_USER: "dawwen",
  DB_PASSWORD: "p@ss/word:1",
  AUDIO_BUCKET: "bucket",
  AUDIO_QUEUE_URL: "http://localhost:4566/000000000000/queue",
  APP_SECRET: "x".repeat(32),
  PRICING_CONFIG: pricing,
};

describe("buildDatabaseUrl", () => {
  it("URL-encodes credentials and adds sslmode only when required", () => {
    const url = buildDatabaseUrl({
      host: "db",
      port: 5432,
      name: "meetings",
      user: "app",
      password: "p@ss/word:1",
      ssl: true,
    });
    expect(url).toBe(
      "postgresql://app:p%40ss%2Fword%3A1@db:5432/meetings?schema=public&sslmode=require",
    );
    expect(new URL(url).password).toBe("p%40ss%2Fword%3A1");
  });
});

describe("loadApiConfig", () => {
  it("loads defaults safe for development (fake providers, port 8080)", () => {
    const cfg = loadApiConfig(baseEnv);
    expect(cfg.port).toBe(8080);
    expect(cfg.asrProvider).toBe("fake");
    expect(cfg.llmProvider).toBe("fake");
    expect(cfg.authProvider).toBe("local");
    expect(cfg.databaseUrl).not.toContain("sslmode");
    expect(cfg.corsOrigins).toEqual(["http://localhost:5173"]);
  });

  it("requires Bedrock model ids when LLM_PROVIDER=bedrock (no hardcoded models)", () => {
    expect(() => loadApiConfig({ ...baseEnv, LLM_PROVIDER: "bedrock" })).toThrow(/BEDROCK_MODEL_ID/);
  });

  it("rejects a short APP_SECRET without echoing its value", () => {
    try {
      loadApiConfig({ ...baseEnv, APP_SECRET: "short-secret-value" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain("APP_SECRET");
      expect((err as Error).message).not.toContain("short-secret-value");
    }
  });

  it("forbids LocalStack endpoint in production", () => {
    expect(() =>
      loadApiConfig({ ...baseEnv, NODE_ENV: "production", AWS_ENDPOINT_URL: "http://x:4566" }),
    ).toThrow(/AWS_ENDPOINT_URL/);
  });

  it("rejects invalid pricing JSON", () => {
    expect(() => loadApiConfig({ ...baseEnv, PRICING_CONFIG: "{bad" })).toThrow(/PRICING_CONFIG/);
  });
});

describe("loadWorkerConfig", () => {
  it("requires ASR_API_KEY for real providers", () => {
    expect(() => loadWorkerConfig({ ...baseEnv, ASR_PROVIDER: "elevenlabs" })).toThrow(
      /ASR_API_KEY/,
    );
    expect(loadWorkerConfig(baseEnv).asrProvider).toBe("fake");
  });
});
