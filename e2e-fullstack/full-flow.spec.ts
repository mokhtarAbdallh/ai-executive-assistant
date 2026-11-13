import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { USER_FILE } from "./global-setup";

/** One second of silent 16 kHz mono PCM WAV (the fake ASR ignores the content). */
function silentWav(): Buffer {
  const pcm = Buffer.alloc(32_000);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * The whole product path against the real API + worker (ADR-025):
 * login → new meeting with consent → browser upload to S3 → S3 event → SQS → worker
 * (fake ASR/LLM) → review → approve the extracted items → approve the AI proposal.
 */
test("login, upload, processing, review and approval end to end", async ({ page }) => {
  const user = JSON.parse(readFileSync(USER_FILE, "utf8")) as { email: string; password: string };

  await page.goto("/");
  await page.getByLabel("الإيميل").fill(user.email);
  await page.getByLabel("الباسورد").fill(user.password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.getByRole("heading", { name: "الاجتماعات", exact: true })).toBeVisible();

  // New meeting: consent is required before anything is uploaded (Invariant 4).
  await page.getByRole("button", { name: "اجتماع جديد" }).first().click();
  await page.locator("#meeting-title").fill("اجتماع متابعة الإطلاق");
  await page.getByRole("button", { name: "رفع ملف" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "meeting.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });
  const submit = page.getByRole("button", { name: "ارفع وابدأ المعالجة" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("أؤكد إن كل المشاركين موافقين على تسجيل الاجتماع ومعالجته.").check();
  await submit.click();

  // Upload → S3 notification → SQS → worker → REVIEW_PENDING, then the detail view opens.
  const approveAll = page.getByRole("button", { name: "اعتماد الكل" });
  await expect(approveAll).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("اجتماع متابعة الإطلاق").first()).toBeVisible();

  // Human review: approve the extracted decisions and tasks.
  await approveAll.click();
  await expect(page.getByText("تم اعتماد كل العناصر")).toBeVisible();

  // The AI only proposed the follow-up meeting; it runs after the user approves it (Invariant 1).
  await page.locator('[data-nav="proposals"]:visible').click();
  await expect(page.getByRole("heading", { name: "صندوق المقترحات" })).toBeVisible();
  await page
    .getByRole("button", { name: /موافقة و(جدولة|تنفيذ)/ })
    .first()
    .click();
  await expect(page.getByText("تم تنفيذ المقترح").first()).toBeVisible({ timeout: 15_000 });
});
