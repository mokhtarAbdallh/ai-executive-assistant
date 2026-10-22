import { normalizeCodeSwitchedText } from "../post-processor.js";
import type {
  SpeechToText,
  TranscribeOptions,
  TranscriptionResult,
  TranscriptSegmentResult,
} from "../types.js";

export const FAKE_DEMO_SEGMENTS: TranscriptSegmentResult[] = [
  {
    id: "seg-1",
    speakerLabel: "Speaker 1 (أحمد)",
    startMs: 0,
    endMs: 8500,
    text: "صباح الخير يا شباب، النهاردة عاوزين نراجع الـ sprint goal ونشوف تقدم الـ backend والـ frontend.",
    confidence: 0.98,
  },
  {
    id: "seg-2",
    speakerLabel: "Speaker 2 (سارة)",
    startMs: 9000,
    endMs: 18200,
    text: "أنا خلصت الـ auth API بالكامل وعملت integration مع الـ database، بس لسه مستنية الـ UI designs الجديدة.",
    confidence: 0.95,
  },
  {
    id: "seg-3",
    speakerLabel: "Speaker 3 (عمر)",
    startMs: 18800,
    endMs: 29500,
    text: "الـ UI designs جهزت على Figma، هبعت اللينك لسارة النهاردة بالليل عشان تبدأ تركب الـ components.",
    confidence: 0.97,
  },
  {
    id: "seg-4",
    speakerLabel: "Speaker 1 (أحمد)",
    startMs: 30000,
    endMs: 42000,
    text: "تمام جداً، اتفقنا إننا هنعتمد PostgreSQL مع pgvector للـ semantic search، ومفيش داعي لـ OpenSearch في الـ MVP.",
    confidence: 0.99,
  },
  {
    id: "seg-5",
    speakerLabel: "Speaker 2 (سارة)",
    startMs: 42500,
    endMs: 51200,
    text: "ممتاز، ومين المسؤول عن إعداد الـ Terraform scripts الخاصة بالـ AWS ECS؟",
    confidence: 0.96,
  },
  {
    id: "seg-6",
    speakerLabel: "Speaker 1 (أحمد)",
    startMs: 51800,
    endMs: 63400,
    text: "أنا هخلص الـ Terraform بحلول يوم الخميس الجاي. ونحدد ميتنج تاني يوم الأحد الساعة 2 الظهر لمراجعة الـ deployment.",
    confidence: 0.98,
  },
];

export class FakeSpeechToText implements SpeechToText {
  public readonly providerName = "fake";

  async transcribe(
    _audio: Buffer | Uint8Array | string,
    _options?: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    const segments = FAKE_DEMO_SEGMENTS.map((seg) => ({
      ...seg,
      text: normalizeCodeSwitchedText(seg.text),
    }));

    const fullText = segments.map((s) => s.text).join(" ");

    return {
      text: fullText,
      language: "ar-EG",
      durationSeconds: 64,
      segments,
    };
  }
}
