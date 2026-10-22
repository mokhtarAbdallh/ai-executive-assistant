-- Enable pgvector and pg_trgm extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create Enums
CREATE TYPE "Role" AS ENUM ('OWNER', 'MEMBER', 'GUEST');
CREATE TYPE "MeetingStatus" AS ENUM ('UPLOADED', 'QUEUED', 'TRANSCRIBING', 'ANALYZING', 'REVIEW_PENDING', 'APPROVED', 'FAILED');
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "TaskStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED', 'FAILED');
CREATE TYPE "ProposalActionType" AS ENUM ('SCHEDULE_MEETING', 'DRAFT_EMAIL', 'SEND_REMINDER', 'CREATE_TASK');
CREATE TYPE "ReminderStatus" AS ENUM ('SCHEDULED', 'SENT', 'CANCELLED');
CREATE TYPE "CreditTransactionType" AS ENUM ('CREDIT_TOPUP', 'CREDIT_RESERVE', 'CREDIT_SETTLE', 'CREDIT_REFUND');

-- Users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- User Settings
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "audioRetentionDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- Recording Consents
CREATE TABLE "recording_consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingId" TEXT,
    "participantEmail" TEXT,
    "participantName" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentMethod" TEXT NOT NULL DEFAULT 'ui_checkbox',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "recording_consents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recording_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "recording_consents_userId_idx" ON "recording_consents"("userId");
CREATE INDEX "recording_consents_meetingId_idx" ON "recording_consents"("meetingId");

-- Meetings
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "status" "MeetingStatus" NOT NULL DEFAULT 'UPLOADED',
    "language" TEXT NOT NULL DEFAULT 'ar',
    "audioSource" TEXT NOT NULL DEFAULT 'upload',
    "audioS3Key" TEXT,
    "audioDurationSeconds" INTEGER,
    "audioDeletedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meetings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "meetings_userId_idx" ON "meetings"("userId");
CREATE INDEX "meetings_userId_status_idx" ON "meetings"("userId", "status");

-- Meeting Participants
CREATE TABLE "meeting_participants" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "speakerLabel" TEXT,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meeting_participants_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "meeting_participants_meetingId_idx" ON "meeting_participants"("meetingId");

-- Transcript Segments
CREATE TABLE "transcript_segments" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "speakerLabel" TEXT,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transcript_segments_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "transcript_segments_meetingId_idx" ON "transcript_segments"("meetingId");

-- Meeting Analysis
CREATE TABLE "meeting_analyses" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "tldr" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meeting_analyses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meeting_analyses_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "meeting_analyses_meetingId_key" ON "meeting_analyses"("meetingId");

-- Agenda Items
CREATE TABLE "agenda_items" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agenda_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agenda_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "agenda_items_meetingId_idx" ON "agenda_items"("meetingId");

-- Topics Discussion
CREATE TABLE "topic_discussions" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceTs" TEXT,
    "sourceSegmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "topic_discussions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "topic_discussions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "topic_discussions_meetingId_idx" ON "topic_discussions"("meetingId");

-- Decisions
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceTs" TEXT,
    "sourceSegmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "decisions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "decisions_meetingId_idx" ON "decisions"("meetingId");

-- Tasks
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerName" TEXT,
    "ownerEmail" TEXT,
    "dueDate" TIMESTAMP(3),
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'NEW',
    "sourceTs" TEXT,
    "sourceSegmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tasks_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "tasks_meetingId_idx" ON "tasks"("meetingId");

-- Open Questions
CREATE TABLE "open_questions" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "askedBy" TEXT,
    "sourceTs" TEXT,
    "sourceSegmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "open_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "open_questions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "open_questions_meetingId_idx" ON "open_questions"("meetingId");

-- Document References
CREATE TABLE "document_references" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "documentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_references_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_references_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "document_references_meetingId_idx" ON "document_references"("meetingId");

-- Proposals (Human-in-the-loop)
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingId" TEXT,
    "actionType" "ProposalActionType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT,
    "executedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proposals_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposals_userId_idx" ON "proposals"("userId");
CREATE INDEX "proposals_userId_status_idx" ON "proposals"("userId", "status");
CREATE INDEX "proposals_meetingId_idx" ON "proposals"("meetingId");

-- Follow Up Drafts
CREATE TABLE "follow_up_drafts" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "recipientName" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "follow_up_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "follow_up_drafts_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "follow_up_drafts_meetingId_idx" ON "follow_up_drafts"("meetingId");

-- Reminders
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "meetingId" TEXT,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'console',
    "status" "ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reminders_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reminders_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "reminders_userId_idx" ON "reminders"("userId");
CREATE INDEX "reminders_taskId_idx" ON "reminders"("taskId");
CREATE INDEX "reminders_remindAt_status_idx" ON "reminders"("remindAt", "status");

-- Calendar Connections
CREATE TABLE "calendar_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "encryptedTokens" TEXT NOT NULL,
    "calendarId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'idle',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calendar_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "calendar_connections_userId_idx" ON "calendar_connections"("userId");

-- Credit Ledger
CREATE TABLE "credit_ledgers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balanceMicros" BIGINT NOT NULL DEFAULT 0,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "credit_ledgers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_ledgers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "credit_ledgers_userId_key" ON "credit_ledgers"("userId");

-- Credit Transactions
CREATE TABLE "credit_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "transactionType" "CreditTransactionType" NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "credit_transactions_userId_idx" ON "credit_transactions"("userId");

-- Usage Events
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingId" TEXT,
    "operationType" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "costMicros" BIGINT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "usage_events_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "usage_events_userId_idx" ON "usage_events"("userId");
CREATE INDEX "usage_events_meetingId_idx" ON "usage_events"("meetingId");

-- Edit Histories
CREATE TABLE "edit_histories" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "originalValue" JSONB NOT NULL,
    "editedValue" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "edit_histories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "edit_histories_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "edit_histories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "edit_histories_meetingId_idx" ON "edit_histories"("meetingId");
CREATE INDEX "edit_histories_userId_idx" ON "edit_histories"("userId");

-- Meeting Embeddings (pgvector)
CREATE TABLE "meeting_embeddings" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "segmentId" TEXT,
    "text" TEXT NOT NULL,
    "embedding" vector(1024),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_embeddings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meeting_embeddings_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "meeting_embeddings_meetingId_idx" ON "meeting_embeddings"("meetingId");

-- HNSW Vector Index (cosine distance)
CREATE INDEX IF NOT EXISTS "meeting_embeddings_vector_hnsw_idx"
ON "meeting_embeddings"
USING hnsw ("embedding" vector_cosine_ops);

-- Trigram Indexes for substring search
CREATE INDEX IF NOT EXISTS "meetings_title_trgm_idx" ON "meetings" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "decisions_text_trgm_idx" ON "decisions" USING gin ("text" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "tasks_title_trgm_idx" ON "tasks" USING gin ("title" gin_trgm_ops);

-- Full Text Search Indexes (simple configuration, compatible with mixed Arabic/English)
CREATE INDEX IF NOT EXISTS "transcript_segments_fts_idx" ON "transcript_segments" USING gin (to_tsvector('simple', "text"));
CREATE INDEX IF NOT EXISTS "meetings_title_fts_idx" ON "meetings" USING gin (to_tsvector('simple', "title"));
