import { z } from "zod";
import { buildDatabaseUrl } from "./database-url.js";
import { parsePricingConfig, type PricingConfig } from "./pricing.js";

type Env = Record<string, string | undefined>;

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/**
 * Variables injected into containers by infra/terraform/ecs.tf (+ ADR-009 additions).
 * Do not add variables here without the matching Terraform change.
 */
const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AWS_REGION: z.string().min(1),
  /** Local only (LocalStack). Never set in ECS. */
  AWS_ENDPOINT_URL: optionalString,

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),

  AUDIO_BUCKET: z.string().min(1),
  AUDIO_QUEUE_URL: z.string().url(),

  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),

  BEDROCK_MODEL_ID: optionalString,
  BEDROCK_EMBEDDING_MODEL_ID: optionalString,
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),
  AUTH_PROVIDER: z.enum(["local", "cognito"]).default("local"),
  /** Required when AUTH_PROVIDER=cognito (ADR-017). */
  COGNITO_USER_POOL_ID: optionalString,
  COGNITO_CLIENT_ID: optionalString,
  ASR_PROVIDER: z
    .enum(["elevenlabs", "speechmatics", "whisper-http", "qwencleo-http", "transcribe", "fake"])
    .default("fake"),
  /** Required when ASR_PROVIDER=qwencleo-http or whisper-http (self-hosted ASR server, ADR-018). */
  ASR_HTTP_URL: optionalString,
  /** Shared by api + worker (read only where needed). */
  DEMO_MODE: booleanString,
  PUBLIC_BASE_URL: optionalString,
  LLM_PROVIDER: z.enum(["bedrock", "fake"]).default("fake"),
  PRICING_CONFIG: z.string().min(2),
});

type BaseEnv = z.infer<typeof baseSchema>;

export interface BaseConfig {
  env: BaseEnv["NODE_ENV"];
  isProduction: boolean;
  awsRegion: string;
  awsEndpointUrl: string | undefined;
  databaseUrl: string;
  audioBucket: string;
  audioQueueUrl: string;
  appSecret: string;
  bedrock: { modelId: string | undefined; embeddingModelId: string | undefined };
  embeddingDim: number;
  authProvider: BaseEnv["AUTH_PROVIDER"];
  asrProvider: BaseEnv["ASR_PROVIDER"];
  asrHttpUrl: string | undefined;
  llmProvider: BaseEnv["LLM_PROVIDER"];
  demoMode: boolean;
  publicBaseUrl: string | undefined;
  pricing: PricingConfig;
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    // Only variable names and rule messages are reported; values are never echoed.
    super(`Invalid configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

function crossFieldChecks(e: BaseEnv): string[] {
  const issues: string[] = [];
  if (e.LLM_PROVIDER === "bedrock") {
    if (!e.BEDROCK_MODEL_ID) issues.push("BEDROCK_MODEL_ID: required when LLM_PROVIDER=bedrock");
    if (!e.BEDROCK_EMBEDDING_MODEL_ID)
      issues.push("BEDROCK_EMBEDDING_MODEL_ID: required when LLM_PROVIDER=bedrock");
  }
  if (e.AUTH_PROVIDER === "cognito" && !e.COGNITO_USER_POOL_ID) {
    issues.push("COGNITO_USER_POOL_ID: required when AUTH_PROVIDER=cognito (no mock pool fallback)");
  }
  if (isHttpAsrProvider(e.ASR_PROVIDER) && !e.ASR_HTTP_URL) {
    issues.push(`ASR_HTTP_URL: required when ASR_PROVIDER=${e.ASR_PROVIDER}`);
  }
  if (e.NODE_ENV === "production") {
    if (e.AWS_ENDPOINT_URL) issues.push("AWS_ENDPOINT_URL: must not be set in production");
    if (e.DEMO_MODE && (e.ASR_PROVIDER !== "fake" || e.LLM_PROVIDER !== "fake")) {
      issues.push("DEMO_MODE: requires ASR_PROVIDER=fake and LLM_PROVIDER=fake");
    }
  }
  return issues;
}

/** Providers that talk to a self-hosted HTTP ASR server instead of a SaaS API. */
export function isHttpAsrProvider(provider: string): boolean {
  return provider === "qwencleo-http" || provider === "whisper-http";
}

/** Providers that need a SaaS-style API key credential. */
export function isKeyedAsrProvider(provider: string): boolean {
  return !isHttpAsrProvider(provider) && provider !== "fake";
}

function toBaseConfig(e: BaseEnv): BaseConfig {
  let pricing: PricingConfig;
  try {
    pricing = parsePricingConfig(e.PRICING_CONFIG);
  } catch (err) {
    const msg = err instanceof z.ZodError ? formatIssues(err).join("; ") : (err as Error).message;
    throw new ConfigError([`PRICING_CONFIG: ${msg}`]);
  }
  const isProduction = e.NODE_ENV === "production";
  return {
    env: e.NODE_ENV,
    isProduction,
    awsRegion: e.AWS_REGION,
    awsEndpointUrl: e.AWS_ENDPOINT_URL,
    databaseUrl: buildDatabaseUrl({
      host: e.DB_HOST,
      port: e.DB_PORT,
      name: e.DB_NAME,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      ssl: isProduction,
    }),
    audioBucket: e.AUDIO_BUCKET,
    audioQueueUrl: e.AUDIO_QUEUE_URL,
    appSecret: e.APP_SECRET,
    bedrock: { modelId: e.BEDROCK_MODEL_ID, embeddingModelId: e.BEDROCK_EMBEDDING_MODEL_ID },
    embeddingDim: e.EMBEDDING_DIM,
    authProvider: e.AUTH_PROVIDER,
    asrProvider: e.ASR_PROVIDER,
    asrHttpUrl: e.ASR_HTTP_URL,
    llmProvider: e.LLM_PROVIDER,
    demoMode: e.DEMO_MODE,
    publicBaseUrl: e.PUBLIC_BASE_URL,
    pricing,
  };
}

function parseWith<S extends z.ZodTypeAny>(schema: S, env: Env): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) throw new ConfigError(formatIssues(result.error));
  const issues = crossFieldChecks(result.data as BaseEnv);
  if (issues.length > 0) throw new ConfigError(issues);
  return result.data;
}

/* ---------------- api ---------------- */
const apiSchema = baseSchema.extend({
  /** JSON string: {"client_id": "...", "client_secret": "..."} (optional until Phase 4). */
  GOOGLE_OAUTH: optionalString,
  /** Local-dev CORS allowlist (comma separated). In AWS the web and api share one origin. */
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
});

export interface ApiConfig extends BaseConfig {
  port: number;
  googleOAuthJson: string | undefined;
  corsOrigins: string[];
  cognitoUserPoolId: string | undefined;
  cognitoClientId: string | undefined;
}

/** Terraform contract: api container port. */
export const API_PORT = 8080;

export function loadApiConfig(env: Env = process.env): ApiConfig {
  const e = parseWith(apiSchema, env);
  return {
    ...toBaseConfig(e),
    port: API_PORT,
    googleOAuthJson: e.GOOGLE_OAUTH,
    corsOrigins: e.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cognitoUserPoolId: e.COGNITO_USER_POOL_ID,
    cognitoClientId: e.COGNITO_CLIENT_ID,
    asrHttpUrl: e.ASR_HTTP_URL,
  };
}

/* ---------------- worker ---------------- */
const workerSchema = baseSchema.extend({
  ASR_API_KEY: optionalString,
  ASR_HTTP_API_KEY: optionalString,
  /** Free-form JSON string; parsed by the provider adapter. */
  ASR_HTTP_OPTIONS: optionalString,
  /** Sweep meetings stuck in TRANSCRIBING/ANALYZING; 0 disables (ADR-019). */
  STUCK_SWEEP_SECONDS: z.coerce.number().int().nonnegative().default(300),
  /** Meetings older than this in TRANSCRIBING/ANALYZING are marked FAILED. */
  STUCK_MEETING_MINUTES: z.coerce.number().int().positive().default(30),
  /** Reminder dispatcher tick; 0 disables (ADR-020). */
  REMINDER_DISPATCH_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /** Verified SES sender identity; email channel is only used when set. */
  EMAIL_FROM: optionalString,
});

export interface WorkerConfig extends BaseConfig {
  asrApiKey: string | undefined;
  asrHttpApiKey: string | undefined;
  asrHttpOptionsJson: string | undefined;
  stuckSweepSeconds: number;
  stuckMeetingMinutes: number;
  reminderDispatchSeconds: number;
  emailFrom: string | undefined;
}

export function loadWorkerConfig(env: Env = process.env): WorkerConfig {
  const e = parseWith(workerSchema, env);
  if (isKeyedAsrProvider(e.ASR_PROVIDER) && !e.ASR_API_KEY) {
    throw new ConfigError([`ASR_API_KEY: required when ASR_PROVIDER=${e.ASR_PROVIDER}`]);
  }
  return {
    ...toBaseConfig(e),
    asrApiKey: e.ASR_API_KEY,
    asrHttpApiKey: e.ASR_HTTP_API_KEY,
    asrHttpOptionsJson: e.ASR_HTTP_OPTIONS,
    stuckSweepSeconds: e.STUCK_SWEEP_SECONDS,
    stuckMeetingMinutes: e.STUCK_MEETING_MINUTES,
    reminderDispatchSeconds: e.REMINDER_DISPATCH_SECONDS,
    emailFrom: e.EMAIL_FROM,
  };
}
