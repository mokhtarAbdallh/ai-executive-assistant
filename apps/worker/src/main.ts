import { ConfigError, loadDotEnvForDev, loadWorkerConfig, type WorkerConfig } from "@dawwen/config";

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

async function main(): Promise<void> {
  const config = readConfig();

  // Structured logger pattern (no raw secret logging)
  const log = {
    info: (msg: string, meta?: Record<string, unknown>) => {
      process.stdout.write(
        JSON.stringify({ level: "info", time: new Date().toISOString(), msg, ...meta }) + "\n",
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
    queueUrl: config.audioQueueUrl,
  });

  let running = true;

  const shutdown = (signal: string) => {
    log.info(`received ${signal}, shutting down worker`);
    running = false;
    // Allow active long-polls/jobs to finish gracefully
    setTimeout(() => process.exit(0), 1000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // SQS Consumer heartbeat loop (Phase 2 connects full pipeline)
  while (running) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

void main();
