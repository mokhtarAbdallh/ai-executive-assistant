import type {
  MeetingSummary,
  MeetingDetail,
  Task,
  Decision,
  CalendarEventItem,
  CalendarConnectionStatus,
  Proposal,
  FollowUpDraft,
  Reminder,
  SearchCitation,
  AgentResponse,
  BillingBalance,
  CreditTransactionItem,
  UsageSummary,
  UsageEventItem,
  UserSettings,
} from "./types";

const TOKEN_KEY = "dawwen_access_token";

// In-memory demo store for seamless offline/standalone browser verification
const DEMO_MEETINGS_STORE: MeetingDetail[] = [
  {
    id: "demo-meet-01",
    title: "مراجعة السبرنت الأسبوعي — الـ Auth والـ Bedrock Pipeline",
    status: "REVIEW_PENDING",
    language: "mixed",
    audioDurationSeconds: 180,
    scheduledStart: new Date().toISOString(),
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
    _count: {
      tasks: 3,
      decisions: 2,
      transcriptSegments: 4,
    },
    participants: [
      { id: "p1", name: "أحمد مصطفى", role: "Tech Lead" },
      { id: "p2", name: "سارة كمال", role: "Backend Engineer" },
      { id: "p3", name: "عمر خالد", role: "Product Manager" },
    ],
    analysis: {
      id: "an-1",
      meetingId: "demo-meet-01",
      tldr: "تمت مراجعة تقدم سبرنت الـ Core Pipeline والتحقق من عمل الـ LocalStack بنجاح. تم الاتفاق على اعتماد الـ Auth API وتسليم مهام الـ UI قبل نهاية الأسبوع.",
      purpose: "مراجعة تسليمات السبرنت وتوزيع المهام المتبقية للـ Frontend",
      modelName: "bedrock-claude-3-5-sonnet",
      promptVersion: "v1.0.0",
      status: "ready",
      rawJson: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    agendaItems: [
      { id: "ag-1", meetingId: "demo-meet-01", title: "مراجعة حالة الـ Auth API والـ JWT", orderIndex: 0 },
      { id: "ag-2", meetingId: "demo-meet-01", title: "تكامل الـ SQS Worker مع الـ Bedrock", orderIndex: 1 },
      { id: "ag-3", meetingId: "demo-meet-01", title: "تجهيز شاشات الـ Frontend و الـ Review UI", orderIndex: 2 },
    ],
    topics: [
      {
        id: "tp-1",
        meetingId: "demo-meet-01",
        title: "اعتماد بنية الـ Monorepo و الـ Auth",
        summary: "سارة أكدت اكتمال الـ LocalAuthProvider وتأمينه بـ scryptSync مع نجاح اختبارات العزل بين المستأجرين.",
        sourceTs: "00:15",
        sourceSegmentIds: ["seg-1"],
        orderIndex: 0,
      },
      {
        id: "tp-2",
        meetingId: "demo-meet-01",
        title: "خط معالجة الصوت الـ S3 → SQS Worker",
        summary: "تم اختبار معالجة الصوت عبر LocalStack والتأكد من حذف الصوت الخام طبقاً لسياسة الخصوصية.",
        sourceTs: "01:05",
        sourceSegmentIds: ["seg-2", "seg-3"],
        orderIndex: 1,
      },
    ],
    decisions: [
      {
        id: "dec-1",
        meetingId: "demo-meet-01",
        text: "اعتماد الـ Fastify API كبوابة رئيسية لجميع المسارات تحت البادئة /api.",
        sourceTs: "00:28",
        sourceSegmentIds: ["seg-1"],
        confidence: 0.98,
        needsReview: false,
        approved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "dec-2",
        meetingId: "demo-meet-01",
        text: "استخدام ElevenLabs Scribe v2 لمعالجة التفريغ الصوتي مع الـ Diarization.",
        sourceTs: "01:20",
        sourceSegmentIds: ["seg-3"],
        confidence: 0.95,
        needsReview: false,
        approved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    tasks: [
      {
        id: "tsk-1",
        meetingId: "demo-meet-01",
        title: "مراجعة الـ PR الخاص بـ Bedrock LlmClient والـ repair loop",
        description: "التأكد من معالجة أخطاء الـ JSON تلقائياً في حالة الردود المبتورة",
        ownerName: "أحمد مصطفى",
        ownerEmail: "ahmed@example.com",
        dueDate: new Date(Date.now() + 86400000 * 2).toISOString(),
        priority: "HIGH",
        status: "NEW",
        sourceTs: "00:45",
        sourceSegmentIds: ["seg-2"],
        confidence: 0.96,
        needsReview: false,
        approved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "tsk-2",
        meetingId: "demo-meet-01",
        title: "بناء مكونات الـ Meetings UI بالـ Tailwind CSS",
        description: null,
        ownerName: "سارة كمال",
        ownerEmail: "sara@example.com",
        dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
        priority: "MEDIUM",
        status: "NEW",
        sourceTs: "01:40",
        sourceSegmentIds: ["seg-4"],
        confidence: 0.92,
        needsReview: false,
        approved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "tsk-3",
        meetingId: "demo-meet-01",
        title: "تجهيز نموذج الفواتير وحساب استهلاك الـ USD micros",
        description: null,
        ownerName: null, // Hard Invariant 3: unknown owner stays null
        ownerEmail: null,
        dueDate: null, // Hard Invariant 3: unknown due date stays null
        priority: "LOW",
        status: "NEW",
        sourceTs: "02:10",
        sourceSegmentIds: ["seg-4"],
        confidence: 0.85,
        needsReview: true, // Hard Invariant 3: must be true
        approved: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    openQuestions: [
      {
        id: "oq-1",
        meetingId: "demo-meet-01",
        question: "هل سنفعل دعم الـ Whisper كـ fallback في حالة انقطاع الـ API الخارجي؟",
        askedBy: "عمر خالد",
        sourceTs: "02:25",
        sourceSegmentIds: ["seg-4"],
      },
    ],
    proposals: [
      {
        id: "prop-1",
        userId: "user-1",
        meetingId: "demo-meet-01",
        actionType: "SCHEDULE_MEETING",
        payload: {
          proposedDatetime: new Date(Date.now() + 86400000 * 7).toISOString(),
          place: "Google Meet",
          status: "pending_confirmation",
          title: "اجتماع تسليم المرحلة القادمة (Calendar & Proposals)",
        },
        status: "PENDING_APPROVAL", // Hard Invariant 1: human in the loop
        reason: "Follow-up meeting agreed during sprint retro",
        createdAt: new Date().toISOString(),
      },
    ],
    transcriptSegments: [
      {
        id: "seg-1",
        meetingId: "demo-meet-01",
        speakerLabel: "أحمد مصطفى",
        startMs: 0,
        endMs: 25000,
        text: "صباح الخير جميعاً، عايزين نراجع الـ sprint progress ونشوف الـ Auth API والـ Database migration.",
        language: "ar",
        confidence: 0.98,
        createdAt: new Date().toISOString(),
      },
      {
        id: "seg-2",
        meetingId: "demo-meet-01",
        speakerLabel: "سارة كمال",
        startMs: 25500,
        endMs: 55000,
        text: "خلصت الـ Auth API بالكامل، عملت LocalAuthProvider و CognitoAuthProvider، و الـ tests بتعدي بنجاح 100%.",
        language: "mixed",
        confidence: 0.97,
        createdAt: new Date().toISOString(),
      },
      {
        id: "seg-3",
        meetingId: "demo-meet-01",
        speakerLabel: "عمر خالد",
        startMs: 56000,
        endMs: 95000,
        text: "عظيم جداً يا سارة. بالنسبة للـ Core pipeline ربطنا الـ SQS consumer مع الـ ElevenLabs والـ Bedrock client والـ repair loop شغال تمام.",
        language: "mixed",
        confidence: 0.95,
        createdAt: new Date().toISOString(),
      },
      {
        id: "seg-4",
        meetingId: "demo-meet-01",
        speakerLabel: "أحمد مصطفى",
        startMs: 96000,
        endMs: 140000,
        text: "تمام، هراجع الـ PR بتاع الـ Bedrock اليوم، وسارة تبدأ في شاشات الـ Frontend عشان نتحقق من الـ Review UI، ومحتاجين نحدد مسؤول لحسابات الـ Billing لاحقاً.",
        language: "mixed",
        confidence: 0.96,
        createdAt: new Date().toISOString(),
      },
    ],
    editHistories: [
      {
        id: "eh-1",
        meetingId: "demo-meet-01",
        userId: "user-1",
        entityType: "Meeting",
        entityId: "demo-meet-01",
        originalValue: { title: "مراجعة السبرنت" },
        editedValue: { title: "مراجعة السبرنت الأسبوعي — الـ Auth والـ Bedrock Pipeline" },
        createdAt: new Date().toISOString(),
      },
    ],
  },
  {
    id: "demo-meet-02",
    title: "مراجعة تصميم الهوية البصرية ودعم الـ RTL في دوّن",
    status: "APPROVED",
    language: "ar",
    audioDurationSeconds: 120,
    scheduledStart: new Date(Date.now() - 86400000).toISOString(),
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    _count: {
      tasks: 2,
      decisions: 2,
      transcriptSegments: 2,
    },
    participants: [{ id: "p1", name: "أحمد مصطفى" }],
    analysis: {
      id: "an-2",
      meetingId: "demo-meet-02",
      tldr: "تم اعتماد الخط الطباعي Cairo والألوان الداكنة المستوحاة من Slate و Cyan مع دعم كامل للـ RTL.",
      purpose: "حسم قرارات التصميم والتجربة البصرية",
      modelName: "bedrock-claude-3-5-sonnet",
      promptVersion: "v1.0.0",
      status: "ready",
      rawJson: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    agendaItems: [],
    topics: [],
    decisions: [
      {
        id: "dec-21",
        meetingId: "demo-meet-02",
        text: "استخدام dir='auto' على جميع نصوص التفريغ الصوتي لضمان عرض النصوص المزدوجة بدقة.",
        sourceTs: "00:30",
        sourceSegmentIds: ["seg-21"],
        confidence: 0.99,
        needsReview: false,
        approved: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    tasks: [],
    openQuestions: [],
    proposals: [],
    transcriptSegments: [
      {
        id: "seg-21",
        meetingId: "demo-meet-02",
        speakerLabel: "أحمد مصطفى",
        startMs: 0,
        endMs: 30000,
        text: "التصميم لازم يكون مريح للعين، RTL-first، مع دعم مثالي للتبديل بين العربي والإنجليزي.",
        language: "ar",
        confidence: 0.99,
        createdAt: new Date().toISOString(),
      },
    ],
    editHistories: [],
  },
];

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export async function ensureAuth(): Promise<string> {
  const existing = getStoredToken();
  if (existing) return existing;

  try {
    const loginRes = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "demo@dawwen.ai", password: "Password123!" }),
    });

    if (loginRes.ok) {
      const data = await loginRes.json();
      setStoredToken(data.accessToken);
      return data.accessToken;
    }
  } catch {
    // offline
  }

  setStoredToken("demo-mock-token-dawwen");
  return "demo-mock-token-dawwen";
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let token = getStoredToken();
  if (!token) token = await ensureAuth();

  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, { ...options, headers });
}

export async function fetchHealth(): Promise<{ status: string; uptimeSeconds?: number }> {
  try {
    const res = await fetch("/api/health");
    if (res.ok) return res.json();
  } catch {
    // Return demo online status
  }
  return { status: "ok", uptimeSeconds: 120 };
}

export async function fetchMeetings(filter?: {
  status?: string;
  search?: string;
}): Promise<MeetingSummary[]> {
  try {
    const params = new URLSearchParams();
    if (filter?.status && filter.status !== "ALL") params.set("status", filter.status);
    if (filter?.search) params.set("search", filter.search);

    const res = await authFetch(`/api/meetings?${params.toString()}`);
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo store
  }

  return DEMO_MEETINGS_STORE.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    language: m.language,
    audioDurationSeconds: m.audioDurationSeconds,
    scheduledStart: m.scheduledStart,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    _count: m._count,
  }));
}

export async function fetchMeetingDetail(id: string): Promise<MeetingDetail> {
  try {
    const res = await authFetch(`/api/meetings/${id}`);
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo store
  }

  const found = DEMO_MEETINGS_STORE.find((m) => m.id === id);
  if (found) return found;
  return DEMO_MEETINGS_STORE[0]!;
}

export async function createMeeting(data: {
  title: string;
  language?: "ar" | "en" | "mixed";
}): Promise<MeetingSummary> {
  try {
    const res = await authFetch("/api/meetings", {
      method: "POST",
      body: JSON.stringify({ title: data.title, language: data.language || "ar" }),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const newMeeting: MeetingDetail = {
    id: `meet-${Date.now()}`,
    title: data.title,
    status: "UPLOADED",
    language: data.language || "mixed",
    audioDurationSeconds: 120,
    scheduledStart: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _count: { tasks: 0, decisions: 0, transcriptSegments: 0 },
    participants: [],
    analysis: null,
    agendaItems: [],
    topics: [],
    decisions: [],
    tasks: [],
    openQuestions: [],
    proposals: [],
    transcriptSegments: [],
    editHistories: [],
  };

  DEMO_MEETINGS_STORE.unshift(newMeeting);
  return newMeeting;
}

export async function updateMeeting(
  id: string,
  data: { title?: string },
): Promise<MeetingSummary> {
  try {
    const res = await authFetch(`/api/meetings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const found = DEMO_MEETINGS_STORE.find((m) => m.id === id);
  if (found && data.title) {
    found.title = data.title;
    return found;
  }
  return DEMO_MEETINGS_STORE[0]!;
}

export async function deleteMeeting(id: string): Promise<void> {
  try {
    const res = await authFetch(`/api/meetings/${id}`, { method: "DELETE" });
    if (res.ok) return;
  } catch {
    // Fallback
  }

  const idx = DEMO_MEETINGS_STORE.findIndex((m) => m.id === id);
  if (idx !== -1) DEMO_MEETINGS_STORE.splice(idx, 1);
}

export async function updateTask(
  meetingId: string,
  taskId: string,
  data: Partial<Task>,
): Promise<Partial<Task>> {
  try {
    const res = await authFetch(`/api/meetings/${meetingId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const m = DEMO_MEETINGS_STORE.find((meet) => meet.id === meetingId);
  if (m) {
    const t = m.tasks.find((tsk) => tsk.id === taskId);
    if (t) Object.assign(t, data);
  }
  return data;
}

export async function updateDecision(
  meetingId: string,
  decisionId: string,
  data: Partial<Decision>,
): Promise<Partial<Decision>> {
  try {
    const res = await authFetch(`/api/meetings/${meetingId}/decisions/${decisionId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const m = DEMO_MEETINGS_STORE.find((meet) => meet.id === meetingId);
  if (m) {
    const d = m.decisions.find((dec) => dec.id === decisionId);
    if (d) Object.assign(d, data);
  }
  return data;
}

export async function approveAllMeetingItems(meetingId: string): Promise<MeetingSummary> {
  try {
    const res = await authFetch(`/api/meetings/${meetingId}/approve`, { method: "POST" });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const m = DEMO_MEETINGS_STORE.find((meet) => meet.id === meetingId);
  if (m) {
    m.status = "APPROVED";
    m.tasks.forEach((t) => (t.approved = true));
    m.decisions.forEach((d) => (d.approved = true));
    return m;
  }
  return DEMO_MEETINGS_STORE[0]!;
}

export async function processDemoMeeting(meetingId: string): Promise<MeetingDetail> {
  try {
    const res = await authFetch(`/api/meetings/${meetingId}/process-demo`, { method: "POST" });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const found = DEMO_MEETINGS_STORE.find((m) => m.id === meetingId);
  if (found) {
    found.status = "REVIEW_PENDING";
    return found;
  }
  return DEMO_MEETINGS_STORE[0]!;
}

export async function requestUploadUrl(
  meetingId: string,
  data: {
    fileName: string;
    fileSizeBytes: number;
    contentType: string;
    consentConfirmed: boolean;
  },
): Promise<{ uploadUrl: string; s3Key: string }> {
  try {
    const res = await authFetch(`/api/meetings/${meetingId}/upload-url`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }
  return {
    uploadUrl: "https://mock-s3.localstack.dev/upload",
    s3Key: `uploads/demo/${meetingId}/${data.fileName}`,
  };
}

/* ---------------- Calendar & Proposals (Phase 4) ---------------- */

let DEMO_CALENDAR_CONNECTED = true;
let DEMO_LAST_SYNCED = new Date().toISOString();

const DEMO_PROPOSALS_STORE: Proposal[] = [
  {
    id: "prop-demo-01",
    userId: "usr-demo",
    meetingId: "demo-meet-01",
    actionType: "SCHEDULE_MEETING",
    payload: {
      title: "اجتماع متابعة ومراجعة إطلاق الـ Production",
      proposedDatetime: new Date(Date.now() + 86400000 * 3).toISOString(),
      place: "Google Meet",
      participants: ["ahmed@dawwen.ai", "sarah@dawwen.ai", "omar@dawwen.ai"],
      durationMinutes: 45,
    },
    status: "PENDING_APPROVAL",
    reason: "اقترح الذكاء الاصطناعي هذا الاجتماع بناءً على الاتفاق في نهاية سبرنت الـ Core Pipeline.",
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: "prop-demo-02",
    userId: "usr-demo",
    meetingId: "demo-meet-01",
    actionType: "SCHEDULE_MEETING",
    payload: {
      title: "جلسة مراجعة أداء الـ Bedrock والـ LocalStack مع فريق الديف أوبس",
      proposedDatetime: new Date(Date.now() + 86400000 * 5).toISOString(),
      place: "Google Meet",
      participants: ["devops@dawwen.ai", "ahmed@dawwen.ai"],
      durationMinutes: 30,
    },
    status: "PENDING_APPROVAL",
    reason: "اتفق الحاضرون على تخصيص جلسة عمل فنية لتأكيد معايير الـ latency والـ IAM roles.",
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: "prop-demo-03",
    userId: "usr-demo",
    meetingId: "demo-meet-01",
    actionType: "SCHEDULE_MEETING",
    payload: {
      title: "اجتماع استعراض خطة الـ RTL مع فريق الـ UX",
      proposedDatetime: new Date(Date.now() - 86400000).toISOString(),
      place: "Google Meet",
      participants: ["ux-lead@dawwen.ai"],
      durationMinutes: 30,
    },
    status: "EXECUTED",
    reason: "تم حجز الموعد مسبقاً بعد موافقة صريحة من المستخدم.",
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

export async function fetchCalendarStatus(): Promise<CalendarConnectionStatus> {
  try {
    const res = await authFetch("/api/calendar/status");
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }
  return {
    connected: DEMO_CALENDAR_CONNECTED,
    provider: "google",
    calendarId: "primary",
    syncStatus: DEMO_CALENDAR_CONNECTED ? "active" : "disconnected",
    lastSyncedAt: DEMO_LAST_SYNCED,
  };
}

export async function connectCalendar(code = "demo_code"): Promise<{ success: boolean; connected: boolean }> {
  try {
    const res = await authFetch("/api/calendar/callback", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      DEMO_CALENDAR_CONNECTED = true;
      DEMO_LAST_SYNCED = new Date().toISOString();
      return res.json();
    }
  } catch {
    // Fallback
  }
  DEMO_CALENDAR_CONNECTED = true;
  DEMO_LAST_SYNCED = new Date().toISOString();
  return { success: true, connected: true };
}

export async function disconnectCalendar(): Promise<void> {
  try {
    await authFetch("/api/calendar/disconnect", { method: "POST" });
  } catch {
    // Fallback
  }
  DEMO_CALENDAR_CONNECTED = false;
}

export async function syncCalendar(): Promise<{ success: boolean; lastSyncedAt: string }> {
  try {
    const res = await authFetch("/api/calendar/sync", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      DEMO_LAST_SYNCED = data.lastSyncedAt;
      return data;
    }
  } catch {
    // Fallback
  }
  DEMO_LAST_SYNCED = new Date().toISOString();
  return { success: true, lastSyncedAt: DEMO_LAST_SYNCED };
}

export async function fetchCalendarEvents(start?: string, end?: string): Promise<CalendarEventItem[]> {
  try {
    const query = new URLSearchParams();
    if (start) query.set("start", start);
    if (end) query.set("end", end);
    const res = await authFetch(`/api/calendar/events?${query.toString()}`);
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  // Demo fallback events
  const now = new Date();
  const d1 = new Date(now.getTime() + 1000 * 60 * 60 * 24);
  d1.setHours(10, 0, 0, 0);
  const d1End = new Date(d1.getTime() + 1000 * 60 * 45);

  const d2 = new Date(now.getTime() + 1000 * 60 * 60 * 48);
  d2.setHours(14, 30, 0, 0);
  const d2End = new Date(d2.getTime() + 1000 * 60 * 60);

  const d3 = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 4);
  d3.setHours(11, 0, 0, 0);
  const d3End = new Date(d3.getTime() + 1000 * 60 * 30);

  const events: CalendarEventItem[] = [
    {
      id: "evt-fake-1",
      title: "مراجعة تصميم الواجهات وسير العمل (UI Sprint Planning)",
      start: d1.toISOString(),
      end: d1End.toISOString(),
      location: "Google Meet",
      attendees: ["ahmed@dawwen.ai", "sarah@dawwen.ai"],
      status: "scheduled",
      htmlLink: "https://calendar.google.com/event?eid=fake1",
    },
    {
      id: "evt-fake-2",
      title: "اجتماع توضيحي مع عميل منصة التجارة الإلكترونية",
      start: d2.toISOString(),
      end: d2End.toISOString(),
      location: "Google Meet",
      attendees: ["client@ecommerce-client.com", "mohamed@dawwen.ai"],
      status: "scheduled",
      htmlLink: "https://calendar.google.com/event?eid=fake2",
    },
    {
      id: "evt-fake-3",
      title: "متابعة أداء الـ Bedrock LLM والـ ElevenLabs ASR",
      start: d3.toISOString(),
      end: d3End.toISOString(),
      location: "Zoom",
      attendees: ["team-lead@dawwen.ai"],
      status: "scheduled",
      htmlLink: "https://calendar.google.com/event?eid=fake3",
    },
  ];

  // Add meetings from DEMO_MEETINGS_STORE
  DEMO_MEETINGS_STORE.forEach((m) => {
    events.push({
      id: `dawwen-m-${m.id}`,
      meetingId: m.id,
      title: m.title,
      start: m.scheduledStart || m.createdAt,
      end: new Date(new Date(m.scheduledStart || m.createdAt).getTime() + (m.audioDurationSeconds || 1800) * 1000).toISOString(),
      description: m.analysis?.tldr,
      status: m.tasks.some((t) => t.needsReview) ? "needs_review" : "summarized",
      isAiBooked: false,
    });
  });

  return events;
}

export async function fetchProposals(status?: string): Promise<Proposal[]> {
  try {
    const query = status ? `?status=${status}` : "";
    const res = await authFetch(`/api/proposals${query}`);
    if (res.ok) {
      const data = await res.json();
      return data.proposals || data;
    }
  } catch {
    // Fallback
  }

  if (status) {
    return DEMO_PROPOSALS_STORE.filter((p) => p.status === status);
  }
  return DEMO_PROPOSALS_STORE;
}

export async function approveProposal(
  proposalId: string,
  execute = true,
): Promise<{ proposal: Proposal; status: string; details: Record<string, unknown> }> {
  try {
    const res = await authFetch(`/api/proposals/${proposalId}/approve?execute=${execute}`, {
      method: "POST",
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const found = DEMO_PROPOSALS_STORE.find((p) => p.id === proposalId);
  if (found) {
    found.status = execute ? "EXECUTED" : "APPROVED";
  }

  return {
    proposal: found || DEMO_PROPOSALS_STORE[0]!,
    status: execute ? "EXECUTED" : "APPROVED",
    details: {
      eventId: `cal-evt-${Date.now()}`,
      htmlLink: "https://calendar.google.com/calendar/r/eventedit",
      bookedTime: found?.payload?.proposedDatetime || new Date().toISOString(),
      title: found?.payload?.title || "اجتماع متابعة محجوز",
    },
  };
}

export async function rejectProposal(proposalId: string, reason?: string): Promise<Proposal> {
  try {
    const res = await authFetch(`/api/proposals/${proposalId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const found = DEMO_PROPOSALS_STORE.find((p) => p.id === proposalId);
  if (found) {
    found.status = "REJECTED";
    found.reason = reason || found.reason;
    return found;
  }
  return DEMO_PROPOSALS_STORE[0]!;
}

// ==========================================
// PHASE 5: FOLLOW-UP, SEARCH & ASK AGENT API
// ==========================================

const DEMO_DRAFTS_STORE: FollowUpDraft[] = [
  {
    id: "draft-demo-1",
    meetingId: "demo-meet-01",
    recipientName: "عمر خالد (مدير المنتج)",
    recipientEmail: "omar@dawwen.ai",
    channel: "email",
    subject: "ملخص مخرجات سبرنت الـ Pipeline والخطوات القادمة",
    body: "أهلاً عمر،\n\nبناءً على اجتماعنا اليوم، نؤكد على إطلاق واجهات المتابعة ومحضر الاجتماع مع التذكيرات المقترحة بحلول الخميس القادم.\n\nتحياتي،\nفريق العمل",
    status: "draft",
    sentAt: null,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

const DEMO_REMINDERS_STORE: Reminder[] = [
  {
    id: "remind-demo-1",
    userId: "usr-demo",
    meetingId: "demo-meet-01",
    taskId: "t-1",
    remindAt: new Date(Date.now() + 86400000).toISOString(),
    channel: "console",
    status: "SCHEDULED",
    sentAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    meeting: { id: "demo-meet-01", title: "مراجعة السبرنت الأسبوعي" },
  },
];

/**
 * Ask AI Agent query (scoped to meeting or global)
 */
export async function askAgent(
  query: string,
  meetingId?: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<AgentResponse> {
  try {
    const res = await authFetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ query, meetingId, conversationHistory }),
    });
    if (res.ok) return res.json();
  } catch {
    // Offline / Demo fallback
  }

  const clean = query.trim().toLowerCase();
  const isEnglish = /[a-zA-Z]/.test(clean) && !/[\u0600-\u06FF]/.test(clean);

  // Intent 1: Scheduling proposal
  if (clean.includes("احجز") || clean.includes("اقترح اجتماع") || clean.includes("schedule") || clean.includes("book")) {
    const newProp: Proposal = {
      id: `prop-ai-${Date.now()}`,
      userId: "usr-demo",
      meetingId: meetingId || "demo-meet-01",
      actionType: "SCHEDULE_MEETING",
      payload: {
        title: query.replace(/.*(احجز|اقترح|schedule|book)\s+/i, "") || "اجتماع متابعة مقترح",
        proposedDatetime: new Date(Date.now() + 86400000).toISOString(),
        place: "Google Meet",
        durationMinutes: 45,
      },
      status: "PENDING_APPROVAL",
      reason: `اقتراح بناءً على طلب الشات: "${query}"`,
      createdAt: new Date().toISOString(),
    };
    DEMO_PROPOSALS_STORE.unshift(newProp);

    return {
      answer: isEnglish
        ? "A new meeting proposal has been generated and placed in your Proposals Inbox awaiting your approval."
        : `تم تجهيز مقترح حجز اجتماع جديد وهو بانتظار موافقتك الصريحة في صندوق المقترحات.`,
      citations: [],
      proposalsCreated: [newProp],
      draftsCreated: [],
      toolsUsed: ["propose_event"],
      honestUnknown: false,
    };
  }

  // Intent 2: Reminder proposal
  if (clean.includes("فكرني") || clean.includes("تذكير") || clean.includes("remind")) {
    const remProp: Proposal = {
      id: `prop-rem-${Date.now()}`,
      userId: "usr-demo",
      meetingId: meetingId || "demo-meet-01",
      actionType: "SEND_REMINDER",
      payload: {
        note: query.replace(/.*(فكرني|تذكير|remind)\s+/i, "") || "تذكير بمهمة",
        remindAt: new Date(Date.now() + 10800000).toISOString(),
      },
      status: "PENDING_APPROVAL",
      reason: `طلب تذكير عبر الشات`,
      createdAt: new Date().toISOString(),
    };
    DEMO_PROPOSALS_STORE.unshift(remProp);

    return {
      answer: isEnglish
        ? "A reminder proposal has been prepared in your Proposals Inbox awaiting your approval."
        : "تم إنشاء مقترح تذكير جديد وهو بانتظار موافقتك في صندوق المقترحات.",
      citations: [],
      proposalsCreated: [remProp],
      draftsCreated: [],
      toolsUsed: ["create_reminder"],
      honestUnknown: false,
    };
  }

  // Intent 3: Draft message
  if (clean.includes("مسودة") || clean.includes("draft")) {
    const newDraft: FollowUpDraft = {
      id: `draft-ai-${Date.now()}`,
      meetingId: meetingId || "demo-meet-01",
      recipientName: "العميل",
      recipientEmail: "client@example.com",
      channel: "email",
      subject: "متابعة مخرجات الاجتماع",
      body: "عزيزي العميل،\n\nنشكركم على الاجتماع المثمر اليوم ونؤكد لكم التزامنا بجدول التسليم المتفق عليه.\n\nمع التحية،\nفريق العمل",
      status: "draft",
      sentAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    DEMO_DRAFTS_STORE.unshift(newDraft);

    return {
      answer: isEnglish
        ? "A follow-up email draft has been created and saved in the Follow-up tab."
        : "تمت كتابة مسودة رسالة المتابعة وحفظها بنجاح في تبويب 'المتابعة'.",
      citations: [],
      proposalsCreated: [],
      draftsCreated: [newDraft],
      toolsUsed: ["draft_message"],
      honestUnknown: false,
    };
  }

  // Intent 4: Check if question mentions meeting content
  const matchesContent =
    clean.includes("auth") ||
    clean.includes("bedrock") ||
    clean.includes("سارة") ||
    clean.includes("أحمد") ||
    clean.includes("localstack") ||
    clean.includes("pipeline") ||
    clean.includes("مهام") ||
    clean.includes("قرارات");

  if (!matchesContent) {
    // Invariant 3: Honesty on unknown query
    return {
      answer: isEnglish
        ? "This topic was not mentioned in the recorded meetings. I could not find relevant transcript segments or decisions regarding this question."
        : "لم يُذكر هذا الموضوع في الاجتماعات المتوفرة. لم أجد في التفريغ الصوتي أو القرارات أي إشارة متعلقة بهذا السؤال.",
      citations: [],
      proposalsCreated: [],
      draftsCreated: [],
      toolsUsed: ["search_meetings"],
      honestUnknown: true,
    };
  }

  // Answer with citations (Invariant 2)
  return {
    answer: isEnglish
      ? 'Regarding your inquiry: Sarah confirmed completion of the LocalAuthProvider and tenant isolation tests [00:15], while Ahmed agreed to deliver the UI review screens before the end of the week [00:28].'
      : 'بناءً على ما ورد في الاجتماع: أكدت المهندسة سارة اكتمال الـ LocalAuthProvider واختبارات العزل [00:15]، بينما تم الاتفاق على تسليم شاشات مراجعة الواجهات قبل نهاية الأسبوع [00:28].',
    citations: [
      {
        meetingId: "demo-meet-01",
        meetingTitle: "مراجعة السبرنت الأسبوعي",
        timestamp: "[00:15]",
        text: "سارة أكدت اكتمال الـ LocalAuthProvider وتأمينه بـ scryptSync مع نجاح اختبارات العزل بين المستأجرين.",
        score: 0.95,
        matchType: "hybrid",
      },
      {
        meetingId: "demo-meet-01",
        meetingTitle: "مراجعة السبرنت الأسبوعي",
        timestamp: "[00:28]",
        text: "تم الاتفاق على اعتماد الـ Auth API وتسليم مهام الـ UI قبل نهاية الأسبوع.",
        score: 0.9,
        matchType: "hybrid",
      },
    ],
    proposalsCreated: [],
    draftsCreated: [],
    toolsUsed: ["search_meetings"],
    honestUnknown: false,
  };
}

/**
 * Hybrid Search endpoint across meetings
 */
export async function hybridSearch(
  query: string,
  meetingId?: string,
): Promise<{ results: SearchCitation[] }> {
  try {
    const qParams = new URLSearchParams({ q: query });
    if (meetingId) qParams.set("meetingId", meetingId);
    const res = await authFetch(`/api/search?${qParams.toString()}`);
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  if (!query.trim()) return { results: [] };

  const clean = query.toLowerCase();
  const allResults: SearchCitation[] = [
    {
      meetingId: "demo-meet-01",
      meetingTitle: "مراجعة السبرنت الأسبوعي",
      timestamp: "[00:15]",
      text: "سارة أكدت اكتمال الـ LocalAuthProvider وتأمينه بـ scryptSync مع نجاح اختبارات العزل.",
      score: 0.95,
      matchType: "hybrid",
    },
    {
      meetingId: "demo-meet-01",
      meetingTitle: "مراجعة السبرنت الأسبوعي",
      timestamp: "[00:45]",
      text: "عمر خالد: نحتاج تفعيل تذكيرات المتابعة ومسودات الرسائل للعملاء.",
      score: 0.88,
      matchType: "keyword",
    },
  ];
  const demoResults = allResults.filter(
    (r) => r.text.toLowerCase().includes(clean) || clean.includes("سبرنت") || clean.includes("auth"),
  );

  return { results: demoResults };
}

/**
 * Follow-up Drafts
 */
export async function fetchDrafts(meetingId?: string): Promise<{ drafts: FollowUpDraft[] }> {
  try {
    const url = meetingId ? `/api/meetings/${meetingId}/drafts` : "/api/drafts";
    const res = await authFetch(url);
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const drafts = meetingId
    ? DEMO_DRAFTS_STORE.filter((d) => d.meetingId === meetingId)
    : [...DEMO_DRAFTS_STORE];
  return { drafts };
}

export async function createDraft(data: Partial<FollowUpDraft>): Promise<{ draft: FollowUpDraft }> {
  try {
    const res = await authFetch("/api/drafts", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const draft: FollowUpDraft = {
    id: `draft-${Date.now()}`,
    meetingId: data.meetingId || "demo-meet-01",
    recipientEmail: data.recipientEmail || null,
    recipientName: data.recipientName || null,
    channel: data.channel || "email",
    subject: data.subject || "مسودة جديدة",
    body: data.body || "",
    status: "draft",
    sentAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  DEMO_DRAFTS_STORE.unshift(draft);
  return { draft };
}

export async function updateDraft(
  draftId: string,
  data: Partial<FollowUpDraft>,
): Promise<{ draft: FollowUpDraft }> {
  try {
    const res = await authFetch(`/api/drafts/${draftId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const draft = DEMO_DRAFTS_STORE.find((d) => d.id === draftId);
  if (draft) {
    Object.assign(draft, data, { updatedAt: new Date().toISOString() });
    return { draft };
  }
  return { draft: DEMO_DRAFTS_STORE[0]! };
}

export async function proposeSendDraft(draftId: string): Promise<{ proposal: Proposal }> {
  try {
    const res = await authFetch(`/api/drafts/${draftId}/propose-send`, {
      method: "POST",
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const draft = DEMO_DRAFTS_STORE.find((d) => d.id === draftId);
  const proposal: Proposal = {
    id: `prop-send-${Date.now()}`,
    userId: "usr-demo",
    meetingId: draft?.meetingId || null,
    actionType: "DRAFT_EMAIL",
    payload: {
      draftId,
      recipientEmail: draft?.recipientEmail,
      recipientName: draft?.recipientName,
      subject: draft?.subject,
      body: draft?.body || "",
      channel: draft?.channel || "email",
    },
    status: "PENDING_APPROVAL",
    reason: `طلب إرسال مسودة الرسالة إلى: ${draft?.recipientEmail || "العميل"}`,
    createdAt: new Date().toISOString(),
  };
  DEMO_PROPOSALS_STORE.unshift(proposal);
  return { proposal };
}

/**
 * Reminders
 */
export async function fetchReminders(meetingId?: string): Promise<{ reminders: Reminder[] }> {
  try {
    const url = meetingId ? `/api/meetings/${meetingId}/reminders` : "/api/reminders";
    const res = await authFetch(url);
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const reminders = meetingId
    ? DEMO_REMINDERS_STORE.filter((r) => r.meetingId === meetingId)
    : [...DEMO_REMINDERS_STORE];
  return { reminders };
}

export async function createReminder(
  data: Partial<Reminder> & { note?: string; proposeOnly?: boolean },
): Promise<{ reminder?: Reminder; proposal?: Proposal; isProposal: boolean }> {
  try {
    const res = await authFetch("/api/reminders", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  if (data.proposeOnly) {
    const prop: Proposal = {
      id: `prop-rem-${Date.now()}`,
      userId: "usr-demo",
      meetingId: data.meetingId || null,
      actionType: "SEND_REMINDER",
      payload: {
        meetingId: data.meetingId,
        taskId: data.taskId,
        remindAt: data.remindAt || new Date(Date.now() + 86400000).toISOString(),
        channel: data.channel || "console",
        note: data.note || "تذكير جديد",
      },
      status: "PENDING_APPROVAL",
      reason: data.note || "طلب تذكير جديد",
      createdAt: new Date().toISOString(),
    };
    DEMO_PROPOSALS_STORE.unshift(prop);
    return { proposal: prop, isProposal: true };
  }

  const reminder: Reminder = {
    id: `remind-${Date.now()}`,
    userId: "usr-demo",
    meetingId: data.meetingId || null,
    taskId: data.taskId || null,
    remindAt: data.remindAt || new Date(Date.now() + 86400000).toISOString(),
    channel: data.channel || "console",
    status: "SCHEDULED",
    sentAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  DEMO_REMINDERS_STORE.unshift(reminder);
  return { reminder, isProposal: false };
}

export async function cancelReminder(reminderId: string): Promise<{ reminder: Reminder }> {
  try {
    const res = await authFetch(`/api/reminders/${reminderId}/cancel`, {
      method: "POST",
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback
  }

  const found = DEMO_REMINDERS_STORE.find((r) => r.id === reminderId);
  if (found) {
    found.status = "CANCELLED";
    return { reminder: found };
  }
  return { reminder: DEMO_REMINDERS_STORE[0]! };
}

// ==========================================
// Phase 6: Billing, Settings & Data Deletion
// ==========================================

const DEMO_BILLING_BALANCE: BillingBalance = {
  balanceMicros: "15500000",
  reservedMicros: "0",
  availableMicros: "15500000",
  currency: "USD",
  formattedBalance: "$15.50",
};

const DEMO_TRANSACTIONS: CreditTransactionItem[] = [
  {
    id: "tx-demo-1",
    userId: "usr-demo",
    amountMicros: "20000000",
    amountDollars: 20,
    transactionType: "CREDIT_TOPUP",
    referenceType: "topup",
    referenceId: "INSTAPAY-9842",
    description: "شحن رصيد تجريبي عبر انستاباي / التحويل اليدوي",
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: "tx-demo-2",
    userId: "usr-demo",
    amountMicros: "-4500000",
    amountDollars: -4.5,
    transactionType: "CREDIT_SETTLE",
    referenceType: "meeting_usage",
    referenceId: "demo-meet-01",
    description: "استهلاك معالجة اجتماع مراجعة السبرنت الأسبوعي",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

const DEMO_USAGE_SUMMARY: UsageSummary = {
  totalEvents: 4,
  totalAudioMinutes: 45.5,
  totalLlmTokens: 18400,
  totalCostMicros: "4500000",
  totalCostDollars: 4.5,
};

const DEMO_USAGE_EVENTS: UsageEventItem[] = [
  {
    id: "use-1",
    userId: "usr-demo",
    meetingId: "demo-meet-01",
    operationType: "AUDIO_TRANSCRIPTION",
    quantity: 15,
    unit: "minutes",
    costMicros: "3000000",
    costDollars: 3.0,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    meeting: { id: "demo-meet-01", title: "مراجعة السبرنت الأسبوعي" },
  },
  {
    id: "use-2",
    userId: "usr-demo",
    meetingId: "demo-meet-01",
    operationType: "LLM_ANALYSIS",
    quantity: 12500,
    unit: "tokens",
    costMicros: "1500000",
    costDollars: 1.5,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    meeting: { id: "demo-meet-01", title: "مراجعة السبرنت الأسبوعي" },
  },
];

let DEMO_SETTINGS: UserSettings = {
  language: "ar",
  timezone: "Africa/Cairo",
  audioRetentionDays: 7,
};

export async function fetchBillingBalance(): Promise<BillingBalance> {
  try {
    const res = await authFetch("/api/billing/balance");
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo
  }
  return DEMO_BILLING_BALANCE;
}

export async function fetchBillingTransactions(): Promise<{ transactions: CreditTransactionItem[] }> {
  try {
    const res = await authFetch("/api/billing/transactions");
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo
  }
  return { transactions: DEMO_TRANSACTIONS };
}

export async function fetchBillingUsage(): Promise<{ summary: UsageSummary; events: UsageEventItem[] }> {
  try {
    const res = await authFetch("/api/billing/usage");
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo
  }
  return { summary: DEMO_USAGE_SUMMARY, events: DEMO_USAGE_EVENTS };
}

export async function topupCredits(payload: {
  amountDollars?: number;
  reference?: string;
  description?: string;
}): Promise<{ success: boolean; transaction: CreditTransactionItem & { newBalanceMicros?: string; formattedNewBalance?: string } }> {
  try {
    const res = await authFetch("/api/billing/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo
  }

  const dollars = payload.amountDollars ?? 10;
  const micros = dollars * 1_000_000;
  const currentMicros = parseInt(DEMO_BILLING_BALANCE.balanceMicros, 10);
  const newMicros = currentMicros + micros;
  DEMO_BILLING_BALANCE.balanceMicros = newMicros.toString();
  DEMO_BILLING_BALANCE.availableMicros = newMicros.toString();
  DEMO_BILLING_BALANCE.formattedBalance = `$${(newMicros / 1_000_000).toFixed(2)}`;

  const tx: CreditTransactionItem = {
    id: `tx-demo-${Date.now()}`,
    userId: "usr-demo",
    amountMicros: micros.toString(),
    amountDollars: dollars,
    transactionType: "CREDIT_TOPUP",
    referenceType: "topup",
    referenceId: payload.reference || "DEMO-TOPUP",
    description: payload.description || `شحن رصيد تجريبي بقيمة $${dollars}`,
    createdAt: new Date().toISOString(),
  };
  DEMO_TRANSACTIONS.unshift(tx);

  return {
    success: true,
    transaction: {
      ...tx,
      newBalanceMicros: newMicros.toString(),
      formattedNewBalance: DEMO_BILLING_BALANCE.formattedBalance,
    },
  };
}

export async function fetchSettings(): Promise<{ settings: UserSettings }> {
  try {
    const res = await authFetch("/api/settings");
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo
  }
  return { settings: DEMO_SETTINGS };
}

export async function updateSettings(payload: {
  language?: string;
  timezone?: string;
  audioRetentionDays?: number;
}): Promise<{ settings: UserSettings }> {
  try {
    const res = await authFetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo
  }
  DEMO_SETTINGS = { ...DEMO_SETTINGS, ...payload };
  return { settings: DEMO_SETTINGS };
}

export async function exportAccountData(): Promise<Record<string, unknown>> {
  try {
    const res = await authFetch("/api/settings/export");
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo
  }
  return {
    metadata: {
      exportDate: new Date().toISOString(),
      version: "1.0",
      format: "dawwen-account-export",
    },
    user: { id: "usr-demo", email: "demo@dawwen.ai", name: "مستخدم تجريبي" },
    settings: DEMO_SETTINGS,
    balance: DEMO_BILLING_BALANCE,
    transactions: DEMO_TRANSACTIONS,
    usage: DEMO_USAGE_EVENTS,
    meetings: DEMO_MEETINGS_STORE,
  };
}

export async function deleteAccount(): Promise<{ success: boolean }> {
  try {
    const res = await authFetch("/api/settings/account", {
      method: "DELETE",
    });
    if (res.ok) return res.json();
  } catch {
    // Fallback to demo
  }
  return { success: true };
}


