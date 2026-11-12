-- ADR-023: pipeline reliability & privacy defaults.

-- Credit held for an in-flight meeting, so a crash/sweep can release it.
ALTER TABLE "meetings" ADD COLUMN "creditHoldMicros" BIGINT NOT NULL DEFAULT 0;

-- Invariant 5: raw audio is deleted right after transcription by default.
ALTER TABLE "user_settings" ALTER COLUMN "audioRetentionDays" SET DEFAULT 0;

-- Deleting a meeting must not erase the billing/usage audit trail.
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_meetingId_fkey";
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
