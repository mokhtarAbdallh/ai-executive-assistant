import { test, expect } from "@playwright/test";

/**
 * These tests run against the Vite dev server with no API behind it, so every
 * screen renders from the demo fallbacks in `src/api.ts`. That keeps the tests
 * deterministic while still exercising the real UI, i18n and human-in-the-loop
 * flows.
 */

test.describe("Dawwen (دوّن) E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "الاجتماعات", exact: true })).toBeVisible();
  });

  test("RTL/LTR switch keeps the document direction and navigation in sync", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar");

    const arabicSwitch = page.getByRole("group", { name: "اللغة" }).first();
    await arabicSwitch.getByRole("button", { name: "EN", exact: true }).click();

    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(html).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Meetings", exact: true })).toBeVisible();
    await expect(page.locator('[data-nav="billing"]:visible')).toContainText("Billing");

    const englishSwitch = page.getByRole("group", { name: "Language" }).first();
    await englishSwitch.getByRole("button", { name: "AR", exact: true }).click();

    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("heading", { name: "الاجتماعات", exact: true })).toBeVisible();
  });

  test("theme toggle is persisted across reloads", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");

    await page.locator("aside").getByRole("button", { name: "التبديل إلى المظهر النهاري" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.locator("aside").getByRole("button", { name: "التبديل إلى المظهر الليلي" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("navigation across the core views", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "الاجتماعات", exact: true })).toBeVisible();

    await page.locator('[data-nav="calendar"]:visible').click();
    await expect(page.getByRole("heading", { name: "التقويم", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "النهارده" })).toBeVisible();

    await page.locator('[data-nav="proposals"]:visible').click();
    await expect(page.getByRole("heading", { name: "صندوق المقترحات" })).toBeVisible();
    await expect(page.getByRole("button", { name: "افتح التقويم" })).toBeVisible();

    await page.locator('[data-nav="billing"]:visible').click();
    await expect(page.getByRole("heading", { name: "الرصيد والفواتير" })).toBeVisible();
    await expect(page.getByText("الرصيد الحالي", { exact: true })).toBeVisible();
    await expect(page.getByText("دفع حسب الاستخدام", { exact: true })).toBeVisible();

    await page.locator('[data-nav="settings"]:visible').click();
    await expect(page.getByRole("heading", { name: "الإعدادات", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "نزّل نسخة" })).toBeVisible();
  });

  test("meeting detail shows the six sections and sourced review state", async ({ page }) => {
    await page.locator("[data-meeting-card]").first().click();

    for (const tab of ["المحضر", "المهام", "المقترحات", "المتابعة", "التفريغ", "اسأل"]) {
      await expect(page.getByRole("tab", { name: new RegExp(tab) })).toBeVisible();
    }

    await expect(page.getByText(/عناصر محتاجة اعتمادك/)).toBeVisible();
    await expect(page.getByText("الملخص السريع")).toBeVisible();

    await page.getByRole("tab", { name: /المهام/ }).click();
    await expect(page.getByText(/بانتظار الاعتماد: \d+ من \d+/)).toBeVisible();

    await page.getByRole("tab", { name: /التفريغ/ }).click();
    await expect(page.getByText(/المقاطع: \d+ من \d+/)).toBeVisible();
  });

  test("proposals only run after an explicit approval", async ({ page }) => {
    await page.locator('[data-nav="proposals"]:visible').click();
    await expect(page.getByText("مبدأ الأمان")).toBeVisible();

    const approve = page.getByRole("button", { name: "موافقة وجدولة" }).first();
    await expect(approve).toBeVisible();
    await approve.click();

    await expect(page.getByText("تم تنفيذ المقترح")).toBeVisible();
  });

  test("billing top-up uses an accessible dialog", async ({ page }) => {
    await page.locator('[data-nav="billing"]:visible').click();
    await page.getByRole("button", { name: "شحن الرصيد" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "شحن الرصيد" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /\$25/ })).toBeVisible();

    await dialog.getByRole("button", { name: "إلغاء" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("deleting an account requires typing the confirmation word", async ({ page }) => {
    await page.locator('[data-nav="settings"]:visible').click();
    await expect(page.getByText("منطقة الخطر")).toBeVisible();

    await page.getByRole("button", { name: "حذف الحساب", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "تأكيد حذف الحساب" })).toBeVisible();
    await expect(dialog.getByText("اكتب «حذف» للتأكيد", { exact: false })).toBeVisible();

    const confirm = dialog.getByRole("button", { name: "احذف الحساب نهائيًا" });
    await expect(confirm).toBeDisabled();

    await dialog.getByLabel("اكتب «حذف» للتأكيد").fill("حذف");
    await expect(confirm).toBeEnabled();

    await dialog.getByRole("button", { name: "إلغاء" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("command palette searches transcripts with citations", async ({ page }) => {
    await page.keyboard.press("Control+k");

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "ابحث في اجتماعاتك" })).toBeVisible();

    await dialog.getByRole("combobox").fill("auth");
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await expect(dialog.getByRole("option").first()).toContainText("[00:15]");

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test.describe("mobile shell", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("bottom navigation and the more sheet", async ({ page }) => {
      await expect(page.locator("aside")).toBeHidden();

      await page.locator('[data-nav="calendar"]:visible').click();
      await expect(page.getByRole("heading", { name: "التقويم", exact: true })).toBeVisible();

      await page.locator('[data-nav="more"]:visible').click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("heading", { name: "المزيد" })).toBeVisible();
      await expect(sheet.getByRole("button", { name: "الإعدادات" })).toBeVisible();

      await sheet.getByRole("button", { name: "الإعدادات" }).click();
      await expect(page.getByRole("heading", { name: "الإعدادات", exact: true })).toBeVisible();
    });
  });
});
