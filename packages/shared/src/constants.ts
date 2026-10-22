/** Meeting lifecycle (SPEC §3). `failed` is retryable. */
export const MEETING_STATUSES = [
  "uploaded",
  "queued",
  "transcribing",
  "analyzing",
  "review_pending",
  "approved",
  "failed",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Statuses during which the worker owns the meeting (used by the stale-job sweeper). */
export const PROCESSING_STATUSES: readonly MeetingStatus[] = [
  "queued",
  "transcribing",
  "analyzing",
];

export const MEETING_LANGUAGES = ["ar", "en", "mixed", "auto"] as const;
export type MeetingLanguage = (typeof MEETING_LANGUAGES)[number];

export const SUPPORTED_UI_LOCALES = ["ar", "en"] as const;
export type UiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

export const DEFAULT_TIMEZONE = "Africa/Cairo";

/** S3 key prefix contract with infra/terraform (lifecycle + SQS notification filter). */
export const AUDIO_UPLOAD_PREFIX = "uploads/";

export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
] as const;

/** Terraform contract: health check path behind the ALB `/api/*` rule. */
export const API_PREFIX = "/api";
export const API_HEALTH_PATH = "/api/health";
