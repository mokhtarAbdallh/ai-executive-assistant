import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import { createS3Client } from "./services/s3.js";
import { API_PREFIX } from "@dawwen/shared";
import type { PrismaClient } from "@dawwen/db";
import {
  getPrismaClient,
  SettingsRepository,
  ConsentRepository,
  ProposalRepository,
  MeetingRepository,
  TaskRepository,
  DecisionRepository,
  CalendarConnectionRepository,
  FollowUpDraftRepository,
  ReminderRepository,
  CreditRepository,
} from "@dawwen/db";
import { loggerOptions } from "./logger.js";
import { registerErrorHandler } from "./errors.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { settingsRoutes } from "./routes/settings.js";
import { consentRoutes } from "./routes/consents.js";
import { proposalRoutes } from "./routes/proposals.js";
import { calendarRoutes } from "./routes/calendar.js";
import { uploadRoutes } from "./routes/upload.js";
import { meetingsRoutes } from "./routes/meetings.js";
import { SqsAudioQueue, type AudioQueue } from "./services/audio-queue.js";
import { chatRoutes } from "./routes/chat.js";
import { searchRoutes } from "./routes/search.js";
import { followUpRoutes } from "./routes/follow-up.js";
import { billingRoutes } from "./routes/billing.js";
import { LocalAuthProvider } from "./auth/local.provider.js";
import { CognitoAuthProvider } from "./auth/cognito.provider.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import type { IAuthProvider } from "./auth/types.js";
import { HkdfKeyProvider, TokenEncryptor } from "@dawwen/shared";
import type { AgentChatModel, EmbeddingClient } from "@dawwen/llm";
import type { PricingConfig } from "@dawwen/config";
import { type CalendarProvider, FakeCalendarProvider } from "./services/calendar.js";
import { ProposalExecutor } from "./services/proposal-executor.js";
import { SearchService } from "./services/search.js";
import { AgentService } from "./services/agent.js";
import { type PaymentProvider, ManualPaymentAdapter } from "./services/payment.js";
import { DataManagementService } from "./services/data-management.js";

export interface AppOptions {
  corsOrigins: string[];
  logLevel?: string;
  appSecret?: string;
  authProvider?: IAuthProvider;
  localAuthProvider?: LocalAuthProvider;
  prisma?: PrismaClient;
  calendarProvider?: CalendarProvider;
  paymentProvider?: PaymentProvider;
  dataManagementService?: DataManagementService;
  /** Optional embedding client for semantic (pgvector) search, ADR-016. */
  embeddingClient?: EmbeddingClient;
  /** Queue used to re-process failed meetings; defaults to SQS from AUDIO_QUEUE_URL. */
  audioQueue?: AudioQueue;
  /** Tool-using model for the Ask assistant (ADR-024); rule-based fallback when absent. */
  agentChatModel?: AgentChatModel;
  /** Provider prices for metering assistant tokens (Invariant 7). */
  pricing?: PricingConfig;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(opts.logLevel ?? "info"),
    trustProxy: true, // behind the ALB
    bodyLimit: 1024 * 1024, // audio never goes through the API (direct S3 upload)
  });

  // Before any route plugin is registered, so every route inherits it (ADR-024).
  registerErrorHandler(app);

  // Money/credit columns are BigInt; JSON has no BigInt, so send them as strings
  // instead of crashing the response (e.g. meetings.creditHoldMicros).
  app.setReplySerializer((payload) =>
    JSON.stringify(payload, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );

  const prisma = opts.prisma ?? getPrismaClient();
  const appSecret =
    opts.appSecret ?? process.env.APP_SECRET ?? "dawwen-default-dev-secret-32-chars-long";

  let authProvider: IAuthProvider;
  let localAuthProvider: LocalAuthProvider;

  if (opts.authProvider) {
    authProvider = opts.authProvider;
    localAuthProvider = opts.localAuthProvider ?? new LocalAuthProvider(prisma, appSecret);
  } else if (process.env.AUTH_PROVIDER === "cognito") {
    if (!process.env.COGNITO_USER_POOL_ID) {
      throw new Error(
        "COGNITO_USER_POOL_ID is required when AUTH_PROVIDER=cognito (no mock pool fallback)",
      );
    }
    authProvider = new CognitoAuthProvider({
      region: process.env.AWS_REGION ?? "eu-central-1",
      userPoolId: process.env.COGNITO_USER_POOL_ID,
      clientId: process.env.COGNITO_CLIENT_ID,
    });
    localAuthProvider = new LocalAuthProvider(prisma, appSecret);
  } else {
    localAuthProvider = opts.localAuthProvider ?? new LocalAuthProvider(prisma, appSecret);
    authProvider = localAuthProvider;
  }

  await app.register(helmet);
  await app.register(cors, {
    origin: opts.corsOrigins,
    credentials: true,
  });
  await app.register(cookie);

  // Decorate fastify with authenticate hook
  app.decorate("authenticate", createAuthMiddleware(authProvider));

  // Instantiate repositories
  const settingsRepository = new SettingsRepository(prisma);
  const consentRepository = new ConsentRepository(prisma);
  const proposalRepository = new ProposalRepository(prisma);
  const meetingRepository = new MeetingRepository(prisma);
  const taskRepository = new TaskRepository(prisma);
  const decisionRepository = new DecisionRepository(prisma);
  const calendarConnectionRepository = new CalendarConnectionRepository(prisma);
  const draftRepository = new FollowUpDraftRepository(prisma);
  const reminderRepository = new ReminderRepository(prisma);
  const creditRepository = new CreditRepository(prisma);

  const secret =
    opts.appSecret || process.env.APP_SECRET || "default-app-secret-at-least-32-characters-long!";
  const keyProvider = new HkdfKeyProvider(secret);
  const tokenEncryptor = new TokenEncryptor(keyProvider);

  const calendarProvider = opts.calendarProvider || new FakeCalendarProvider();
  const proposalExecutor = new ProposalExecutor(
    proposalRepository,
    calendarConnectionRepository,
    calendarProvider,
    tokenEncryptor,
    draftRepository,
    reminderRepository,
    taskRepository,
    undefined,
    {
      // Simulated calendar/email only outside production (ADR-023).
      allowSimulated: process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true",
    },
  );

  const searchService = new SearchService(prisma, opts.embeddingClient);
  const agentService = new AgentService(
    searchService,
    taskRepository,
    proposalRepository,
    draftRepository,
    reminderRepository,
    meetingRepository,
    { chatModel: opts.agentChatModel, prisma, pricing: opts.pricing },
  );

  // One shared S3 client so uploads, deletion and audio cleanup target the same bucket (ADR-017).
  const s3Client = createS3Client();
  const audioBucket = process.env.AUDIO_BUCKET;

  const paymentProvider = opts.paymentProvider ?? new ManualPaymentAdapter(creditRepository);
  const dataManagementService =
    opts.dataManagementService ??
    new DataManagementService({
      prisma,
      meetingRepository,
      s3Client,
      bucketName: audioBucket,
    });

  // Invariant 6: every route lives under /api (the ALB only forwards /api/* to this service).
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { localAuthProvider, prisma });
      await api.register(settingsRoutes, { settingsRepository, dataManagementService });
      await api.register(consentRoutes, { consentRepository });
      await api.register(proposalRoutes, { proposalRepository, proposalExecutor });
      await api.register(calendarRoutes, {
        calendarConnectionRepository,
        calendarProvider,
        tokenEncryptor,
        prisma,
        stateSecret: secret,
      });
      await api.register(uploadRoutes, {
        meetingRepository,
        consentRepository,
        creditRepository,
        prisma,
        s3Client,
        bucketName: audioBucket,
      });
      await api.register(meetingsRoutes, {
        meetingRepository,
        taskRepository,
        decisionRepository,
        prisma,
        dataManagementService,
        audioQueue: opts.audioQueue ?? SqsAudioQueue.fromEnv(),
        bucketName: audioBucket,
      });
      await api.register(chatRoutes, { agentService });
      await api.register(searchRoutes, { searchService });
      await api.register(followUpRoutes, {
        draftRepository,
        reminderRepository,
        proposalRepository,
      });
      await api.register(billingRoutes, {
        creditRepository,
        paymentProvider,
        prisma,
      });
    },
    { prefix: API_PREFIX },
  );

  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send({ error: "not_found" });
  });

  return app;
}
