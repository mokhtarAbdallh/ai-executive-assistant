const CANONICAL_LATIN_TERMS: Record<string, string> = {
  // Transliterated -> Latin
  الباكيند: "backend",
  باكيند: "backend",
  الفرونتيند: "frontend",
  فرونتيند: "frontend",
  الديبلويمنت: "deployment",
  ديبلويمنت: "deployment",
  الداتابيز: "database",
  داتابيز: "database",
  السبرنت: "sprint",
  سبرنت: "sprint",
  الميتنج: "meeting",
  ميتنج: "meeting",
  الفيتشر: "feature",
  فيتشر: "feature",
  الباج: "bug",
  باج: "bug",
  الداون: "down",
  داون: "down",
  البرودكشن: "production",
  برودكشن: "production",
  السيرفر: "server",
  سيرفر: "server",
  الكاش: "cache",
  كاش: "cache",
  الاي_بي_اي: "API",
  اي_بي_اي: "API",
  api: "API",
  pr: "PR",
  ui: "UI",
  ux: "UX",
  db: "DB",
  qa: "QA",
  mvp: "MVP",
  llm: "LLM",
  asr: "ASR",
  aws: "AWS",
};

/**
 * Post-processes Egyptian Arabic / English code-switched text.
 * Preserves and standardizes English technical terms in Latin script (ADR-005).
 */
export function normalizeCodeSwitchedText(rawText: string): string {
  if (!rawText) return "";

  let result = rawText;

  for (const [term, replacement] of Object.entries(CANONICAL_LATIN_TERMS)) {
    // Unicode-aware word boundary pattern
    const pattern = new RegExp(
      `(?<=^|\\s|[.,!?;:()_\\[\\]{}"'،\\-\\/\u060C\u061B])(${term})(?=$|\\s|[.,!?;:()_\\[\\]{}"'،\\-\\/\u060C\u061B])`,
      "gui",
    );
    result = result.replace(pattern, replacement);
  }

  // Remove duplicate spaces
  return result.replace(/\s+/g, " ").trim();
}

export const standardizeArabicTerms = normalizeCodeSwitchedText;
