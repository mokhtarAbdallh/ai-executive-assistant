import { FakeLlmClient } from "./adapters/fake.js";
import { BedrockLlmClient, type BedrockConfig } from "./adapters/bedrock.js";
import {
  BedrockEmbeddingClient,
  FakeEmbeddingClient,
  type BedrockEmbeddingConfig,
} from "./adapters/embedding.js";
import type { LlmClient, EmbeddingClient } from "./types.js";

export interface CreateLlmOptions {
  provider?: string;
  bedrock?: BedrockConfig;
}

export function createLlmClient(options?: CreateLlmOptions): LlmClient {
  const provider = (options?.provider || process.env.LLM_PROVIDER || "fake").toLowerCase();

  switch (provider) {
    case "bedrock":
      return new BedrockLlmClient(options?.bedrock);
    case "fake":
    default:
      return new FakeLlmClient();
  }
}

export interface CreateEmbeddingOptions {
  provider?: string;
  bedrock?: BedrockEmbeddingConfig;
}

export function createEmbeddingClient(options?: CreateEmbeddingOptions): EmbeddingClient {
  const provider = (options?.provider || process.env.LLM_PROVIDER || "fake").toLowerCase();

  switch (provider) {
    case "bedrock":
      return new BedrockEmbeddingClient(options?.bedrock);
    case "fake":
    default:
      return new FakeEmbeddingClient();
  }
}
