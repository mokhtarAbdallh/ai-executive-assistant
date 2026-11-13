import { FakeLlmClient } from "./adapters/fake.js";
import { BedrockLlmClient, type BedrockConfig } from "./adapters/bedrock.js";
import {
  BedrockEmbeddingClient,
  FakeEmbeddingClient,
  type BedrockEmbeddingConfig,
} from "./adapters/embedding.js";
import {
  OpenAiCompatibleEmbeddingClient,
  OpenAiCompatibleLlmClient,
  type OpenAiCompatibleConfig,
  type OpenAiCompatibleEmbeddingConfig,
} from "./adapters/openai-compatible.js";
import type { LlmClient, EmbeddingClient } from "./types.js";

export interface CreateLlmOptions {
  provider?: string;
  bedrock?: BedrockConfig;
  openaiCompatible?: OpenAiCompatibleConfig;
}

export function createLlmClient(options?: CreateLlmOptions): LlmClient {
  const provider = (options?.provider || process.env.LLM_PROVIDER || "fake").toLowerCase();

  switch (provider) {
    case "bedrock":
      return new BedrockLlmClient(options?.bedrock);
    case "openai-compatible":
      if (!options?.openaiCompatible) throw new Error("openai-compatible LLM needs its config");
      return new OpenAiCompatibleLlmClient(options.openaiCompatible);
    case "fake":
    default:
      return new FakeLlmClient();
  }
}

export interface CreateEmbeddingOptions {
  provider?: string;
  bedrock?: BedrockEmbeddingConfig;
  openaiCompatible?: OpenAiCompatibleEmbeddingConfig;
}

export function createEmbeddingClient(options?: CreateEmbeddingOptions): EmbeddingClient {
  const provider = (options?.provider || process.env.LLM_PROVIDER || "fake").toLowerCase();

  switch (provider) {
    case "bedrock":
      return new BedrockEmbeddingClient(options?.bedrock);
    case "openai-compatible":
      if (!options?.openaiCompatible) throw new Error("openai-compatible embeddings need config");
      return new OpenAiCompatibleEmbeddingClient(options.openaiCompatible);
    case "fake":
    default:
      return new FakeEmbeddingClient();
  }
}
