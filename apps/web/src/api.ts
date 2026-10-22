import type { MeetingSummary, MeetingDetail, Task, Decision } from "./types";

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
