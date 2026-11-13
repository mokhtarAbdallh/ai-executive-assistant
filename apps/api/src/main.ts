import { ConfigError, loadApiConfig, loadDotEnvForDev, type ApiConfig } from "@dawwen/config";
import { BedrockAgentChatModel, createEmbeddingClient } from "@dawwen/llm";
import { getPrismaClient } from "@dawwen/db";
import { buildApp } from "./app.js";
import { GoogleCalendarProvider } from "./services/calendar.js";

function readConfig(): ApiConfig {
  loadDotEnvForDev();
  try {
    return loadApiConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  let calendarProvider;
  if (config.googleOAuthJson) {
    try {
      const parsed = JSON.parse(config.googleOAuthJson) as { client_id?: string; client_secret?: string };
      if (parsed.client_id && parsed.client_secret) {
        calendarProvider = new GoogleCalendarProvider({
          clientId: parsed.client_id,
          clientSecret: parsed.client_secret,
        });
      }
    } catch {
      // Fallback to FakeCalendarProvider
    }
  }

  // Semantic search (pgvector) — enabled only when an embedding model is configured.
  let embeddingClient;
  if (config.llmProvider === "bedrock" && config.bedrock.embeddingModelId) {
    embeddingClient = createEmbeddingClient({
      provider: "bedrock",
      bedrock: {
        region: config.awsRegion,
        endpointUrl: config.awsEndpointUrl,
        modelId: config.bedrock.embeddingModelId,
        dimensions: config.embeddingDim,
      },
    });
  }

  // Ask assistant: Bedrock tool use when an LLM is configured (ADR-024).
  const agentChatModel =
    config.llmProvider === "bedrock"
      ? new BedrockAgentChatModel({
          region: config.awsRegion,
          endpointUrl: config.awsEndpointUrl,
          modelId: config.bedrock.modelId,
        })
      : undefined;

  const app = await buildApp({
    corsOrigins: config.corsOrigins,
    logLevel: config.isProduction ? "info" : "debug",
    appSecret: config.appSecret,
    // Prisma reads DATABASE_URL, which ECS does not set: use the URL built from DB_* (ADR-025).
    prisma: getPrismaClient(config.databaseUrl),
    calendarProvider,
    embeddingClient,
    agentChatModel,
    pricing: config.pricing,
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: config.port });
}

void main();
