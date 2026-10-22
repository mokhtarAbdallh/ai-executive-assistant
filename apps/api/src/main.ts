import { ConfigError, loadApiConfig, loadDotEnvForDev, type ApiConfig } from "@dawwen/config";
import { buildApp } from "./app.js";

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
  const app = await buildApp({
    corsOrigins: config.corsOrigins,
    logLevel: config.isProduction ? "info" : "debug",
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
