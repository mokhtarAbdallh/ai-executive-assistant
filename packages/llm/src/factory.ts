import { FakeLlmClient } from "./adapters/fake.js";
import { BedrockLlmClient, type BedrockConfig } from "./adapters/bedrock.js";
import type { LlmClient } from "./types.js";

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
