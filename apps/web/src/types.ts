export type MeetingStatus =
  | "UPLOADED"
  | "QUEUED"
  | "TRANSCRIBING"
  | "ANALYZING"
  | "REVIEW_PENDING"
  | "APPROVED"
  | "FAILED";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type TaskStatus = "NEW" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  speakerLabel: string | null;
  startMs: number;
  endMs: number;
  text: string;
  language: string | null;
  confidence: number | null;
  createdAt: string;
}

export interface MeetingAnalysis {
  id: string;
  meetingId: string;
  tldr: string;
  purpose: string;
  modelName: string | null;
  promptVersion: string | null;
  status: string;
  rawJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgendaItem {
  id: string;
  meetingId: string;
  title: string;
  orderIndex: number;
}

export interface TopicDiscussion {
  id: string;
  meetingId: string;
  title: string;
  summary: string;
  sourceTs: string | null;
  sourceSegmentIds: string[];
  orderIndex: number;
}

export interface Decision {
  id: string;
  meetingId: string;
  text: string;
  sourceTs: string | null;
  sourceSegmentIds: string[];
  confidence: number | null;
  needsReview: boolean;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  meetingId: string;
  title: string;
  description: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  dueDate: string | null;
  priority: Priority;
  status: TaskStatus;
  sourceTs: string | null;
  sourceSegmentIds: string[];
  confidence: number | null;
  needsReview: boolean;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OpenQuestion {
  id: string;
  meetingId: string;
  question: string;
  askedBy: string | null;
  sourceTs: string | null;
  sourceSegmentIds: string[];
}

export interface ProposalPayload {
  proposedDatetime?: string;
  place?: string;
  title?: string;
  participants?: string[];
  [key: string]: unknown;
}

export interface Proposal {
  id: string;
  userId: string;
  meetingId: string | null;
  actionType: "SCHEDULE_MEETING" | "DRAFT_EMAIL" | "SEND_REMINDER" | "CREATE_TASK";
  payload: ProposalPayload;
  status: "PENDING_APPROVAL" | "APPROVED" | "EXECUTED" | "REJECTED" | "FAILED";
  reason: string | null;
  createdAt: string;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
  htmlLink?: string;
  status: "scheduled" | "summarized" | "processing" | "needs_review";
  meetingId?: string;
  isAiBooked?: boolean;
}

export interface CalendarConnectionStatus {
  connected: boolean;
  provider: string;
  calendarId?: string;
  syncStatus?: string;
  lastSyncedAt: string | null;
}

export interface EditHistory {
  id: string;
  meetingId: string;
  userId: string;
  entityType: string;
  entityId: string;
  originalValue: Record<string, unknown>;
  editedValue: Record<string, unknown>;
  createdAt: string;
}

export interface MeetingSummary {
  id: string;
  title: string;
  status: MeetingStatus;
  language: string;
  audioDurationSeconds: number | null;
  scheduledStart: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
    decisions: number;
    transcriptSegments: number;
  };
}

export interface MeetingDetail extends MeetingSummary {
  participants: Array<{ id: string; name: string; role?: string }>;
  transcriptSegments: TranscriptSegment[];
  analysis: MeetingAnalysis | null;
  agendaItems: AgendaItem[];
  topics: TopicDiscussion[];
  decisions: Decision[];
  tasks: Task[];
  openQuestions: OpenQuestion[];
  proposals: Proposal[];
  followUpDrafts?: FollowUpDraft[];
  reminders?: Reminder[];
  editHistories: EditHistory[];
}

export interface FollowUpDraft {
  id: string;
  meetingId: string;
  recipientEmail: string | null;
  recipientName: string | null;
  channel: string;
  subject: string | null;
  body: string;
  status: string; // 'draft' | 'sent'
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  userId: string;
  meetingId: string | null;
  taskId: string | null;
  remindAt: string;
  channel: string;
  status: "SCHEDULED" | "SENT" | "CANCELLED";
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  task?: Task;
  meeting?: { id: string; title: string };
}

export interface SearchCitation {
  meetingId: string;
  meetingTitle: string;
  segmentId?: string;
  timestamp: string;
  startMs?: number;
  text: string;
  speakerLabel?: string | null;
  score: number;
  matchType: "hybrid" | "keyword" | "semantic";
}

export interface AgentResponse {
  answer: string;
  citations: SearchCitation[];
  proposalsCreated: Proposal[];
  draftsCreated: FollowUpDraft[];
  toolsUsed: string[];
  honestUnknown: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  citations?: SearchCitation[];
  proposals?: Proposal[];
  drafts?: FollowUpDraft[];
  honestUnknown?: boolean;
}

export interface BillingBalance {
  balanceMicros: string;
  reservedMicros: string;
  availableMicros: string;
  currency: string;
  formattedBalance: string;
}

export interface CreditTransactionItem {
  id: string;
  userId: string;
  amountMicros: string;
  amountDollars: number;
  transactionType: "CREDIT_TOPUP" | "CREDIT_RESERVE" | "CREDIT_SETTLE" | "CREDIT_REFUND";
  referenceType: string | null;
  referenceId: string | null;
  description: string;
  createdAt: string;
}

export interface UsageSummary {
  totalEvents: number;
  totalAudioMinutes: number;
  totalLlmTokens: number;
  totalCostMicros: string;
  totalCostDollars: number;
}

export interface UsageEventItem {
  id: string;
  userId: string;
  meetingId: string | null;
  operationType: string;
  quantity: number;
  unit: string;
  costMicros: string;
  costDollars: number;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  meeting?: { id: string; title: string };
}

export interface UserSettings {
  id?: string;
  userId?: string;
  language: string;
  timezone: string;
  audioRetentionDays: number;
  createdAt?: string;
  updatedAt?: string;
}

