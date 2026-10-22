import { MeetingAnalysisSchema, type MeetingAnalysis } from "@dawwen/shared";
import type { LlmClient, TranscriptContext, LlmAnalysisResult } from "../types.js";

export class FakeLlmClient implements LlmClient {
  public readonly providerName = "fake";

  async analyzeMeeting(context: TranscriptContext): Promise<LlmAnalysisResult> {
    const segmentIds = context.segments.map((s) => s.id);
    const seg1 = segmentIds[0] || "seg-1";
    const seg2 = segmentIds[1] || seg1;
    const seg3 = segmentIds[2] || seg2;
    const seg4 = segmentIds[3] || seg3;
    const seg6 = segmentIds[5] || segmentIds[segmentIds.length - 1] || "seg-6";

    const lang = (context.language === "en" ? "en" : context.language === "ar" ? "ar" : "mixed") as
      | "ar"
      | "en"
      | "mixed";

    const rawData = {
      meta: {
        date: new Date().toISOString().split("T")[0],
        time: "10:00",
        language: lang,
        participants: context.participants || ["أحمد", "سارة", "عمر"],
      },
      tldr: "تمت مراجعة تقدم الـ sprint والاتفاق على معمارية الـ backend باستخدام PostgreSQL وpgvector بدلاً من OpenSearch. تم تعيين مهام الـ UI لسارة والـ Terraform لأحمد مع تحديد موعد مراجعة الـ deployment يوم الأحد.",
      purpose: "مراجعة الـ sprint goal وحسم قرارات المعمارية التقنية.",
      agenda: [
        "مراجعة تقدم الـ auth API والـ UI",
        "حسم قرار قاعدة بيانات البحث الدلالي",
        "توزيع مهام الـ Terraform والـ deployment",
      ],
      topics: [
        {
          title: "الـ Auth API وتكامل الواجهات",
          summary: "سارة انتهت من تكامل الـ Auth مع قاعدة البيانات وتنتظر تصاميم الـ UI من عمر.",
          sourceTs: "00:15",
          sourceSegmentIds: [seg2, seg3],
        },
        {
          title: "معمارية البحث الدلالي (Semantic Search)",
          summary: "تم اعتماد pgvector داخل Aurora PostgreSQL لتوفير التكلفة وتبسيط الـ MVP.",
          sourceTs: "00:35",
          sourceSegmentIds: [seg4],
        },
      ],
      decisions: [
        {
          text: "اعتماد PostgreSQL مع pgvector للبحث الدلالي وعدم استخدام OpenSearch في مرحلة الـ MVP.",
          sourceTs: "00:35",
          sourceSegmentIds: [seg4],
          needsReview: false,
        },
      ],
      actionItems: [
        {
          task: "إرسال رابط تصاميم الـ UI على Figma لسارة",
          owner: "عمر",
          due: "2026-10-22",
          priority: "high" as const,
          sourceTs: "00:22",
          sourceSegmentIds: [seg3],
          needsReview: false,
        },
        {
          task: "إعداد ونشر ملفات الـ Terraform الخاصة بـ AWS ECS",
          owner: "أحمد",
          due: "2026-10-25",
          priority: "high" as const,
          sourceTs: "00:55",
          sourceSegmentIds: [seg6],
          needsReview: false,
        },
        {
          task: "تحديث وثائق الـ API في الـ Swagger",
          owner: null, // Test Invariant 3: null owner requires needsReview: true
          due: null,
          priority: "low" as const,
          sourceTs: "00:10",
          sourceSegmentIds: [seg1],
          needsReview: true,
        },
      ],
      openQuestions: [
        "هل سنحتاج إضافة Redis للكاش في المرحلة الثانية؟",
      ],
      nextMeeting: {
        proposedDatetime: "2026-10-26T14:00:00Z",
        place: "Google Meet",
        status: "pending_confirmation" as const,
      },
      documents: [
        "https://www.figma.com/file/mock-dawwen-ui",
      ],
    };

    // Strict validation against shared canonical Zod schema
    const analysis: MeetingAnalysis = MeetingAnalysisSchema.parse(rawData);

    return {
      analysis,
      inputTokens: 1420,
      outputTokens: 530,
      modelName: "fake-claude-3-5-sonnet",
    };
  }
}
