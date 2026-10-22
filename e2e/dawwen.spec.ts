import { test, expect } from "@playwright/test";

test.describe("Dawwen (دوّن) E2E Test Suite", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("RTL and bilingual language toggle", async ({ page }) => {
    // 1. Initial Arabic RTL state
    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar");

    // 2. Switch to English using exact "En" button
    const enBtn = page.getByRole("button", { name: "En", exact: true });
    await expect(enBtn).toBeVisible();
    await enBtn.click();

    // 3. Verify LTR and English language attributes
    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(html).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Meetings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Billing" })).toBeVisible();

    // 4. Switch back to Arabic using exact "عربي" button
    const arBtn = page.getByRole("button", { name: "عربي", exact: true });
    await arBtn.click();
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(page.getByRole("button", { name: "الاجتماعات" })).toBeVisible();
    await expect(page.getByRole("button", { name: "الرصيد" })).toBeVisible();
  });

  test("Navigation across core views (Dashboard/Meetings, Calendar, Proposals, Billing, Settings)", async ({ page }) => {
    // 1. Meetings/Dashboard list is default
    await expect(page.getByText("إجمالي الاجتماعات")).toBeVisible();
    await expect(page.getByText("مهام تحتاج مراجعة")).toBeVisible();

    // 2. Navigate to Calendar
    await page.getByRole("button", { name: "التقويم" }).click();
    await expect(page.getByText("التقويم ومواعيد الاجتماعات")).toBeVisible();

    // 3. Navigate to Proposals inbox
    await page.getByRole("button", { name: /المقترحات/ }).click();
    await expect(page.getByRole("button", { name: "عرض التقويم" })).toBeVisible();

    // 4. Navigate to Billing
    await page.getByRole("button", { name: "الرصيد" }).click();
    await expect(page.getByText("PAY-AS-YOU-GO", { exact: true })).toBeVisible();
    await expect(page.getByText("الرصيد المتاح حالياً")).toBeVisible();

    // 5. Navigate to Settings
    await page.getByRole("button", { name: "الإعدادات" }).click();
    await expect(page.getByText("الإعدادات العامة")).toBeVisible();
    await expect(page.getByRole("button", { name: /تنزيل كامل بياناتي/ })).toBeVisible();
  });

  test("Meeting detail view, tabs, and human review actions", async ({ page }) => {
    // Click "فتح ومراجعة" on the first meeting card
    const openBtn = page.getByText("فتح ومراجعة").first();
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    // Verify detail tabs exist
    await expect(page.getByRole("button", { name: "الملخص والأجندة" })).toBeVisible();
    await expect(page.getByRole("button", { name: /القرارات/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /المهام والإجراءات/ }).first()).toBeVisible();

    // Switch to decisions tab
    await page.getByRole("button", { name: /القرارات/ }).first().click();
    await expect(page.getByText(/المصدر من التسجيل|معتمد/i).first()).toBeVisible();

    // Switch to tasks tab
    await page.getByRole("button", { name: /المهام والإجراءات/ }).first().click();
    await expect(page.getByText(/المسؤول:|تاريخ التسليم:/).first()).toBeVisible();
  });

  test("Calendar and Proposals inbox (Human-in-the-loop validation)", async ({ page }) => {
    await page.getByRole("button", { name: /المقترحات/ }).click();

    // Verify proposals screen rendered with Invariant notice
    await expect(page.getByRole("button", { name: "عرض التقويم" })).toBeVisible();
    await expect(page.getByText(/Hard Invariant 1/)).toBeVisible();

    // Check if an approve button is present and clickable
    const approveBtn = page.getByRole("button", { name: "موافقة وحجز بالتقويم" }).first();
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      await expect(page.getByText(/تم اعتماد المقترح وحجز الموعد بنجاح/)).toBeVisible();
    }
  });

  test("Billing dashboard, balance inspection, and top-up modal", async ({ page }) => {
    await page.getByRole("button", { name: "الرصيد" }).click();

    // Check balance card
    await expect(page.getByText("الرصيد المتاح حالياً")).toBeVisible();
    await expect(page.getByText("PAY-AS-YOU-GO", { exact: true })).toBeVisible();

    // Open Top-up modal
    const topupBtn = page.getByRole("button", { name: /شحن الرصيد/ });
    await topupBtn.click();

    // Verify topup modal
    await expect(page.getByRole("heading", { name: "شحن رصيد الحساب" })).toBeVisible();
    await expect(page.getByRole("button", { name: "$25" })).toBeVisible();

    // Select $25 and submit
    await page.getByRole("button", { name: "$25" }).click();
    await page.getByRole("button", { name: "تأكيد وإيداع الرصيد" }).click();

    // Verify modal closes
    await expect(page.getByRole("heading", { name: "شحن رصيد الحساب" })).not.toBeVisible();
  });

  test("Settings privacy controls and GDPR data export", async ({ page }) => {
    await page.getByRole("button", { name: "الإعدادات" }).click();

    // Verify settings options
    await expect(page.getByText("الإعدادات العامة")).toBeVisible();
    await expect(page.getByText("سياسة الاحتفاظ بالتسجيلات الصوتية")).toBeVisible();

    // Verify data export trigger
    const exportBtn = page.getByRole("button", { name: /تنزيل كامل بياناتي/ });
    await expect(exportBtn).toBeVisible();

    // Verify Danger Zone
    await expect(page.getByText("المنطقة الخطرة (حذف الحساب)")).toBeVisible();
    await expect(page.getByRole("button", { name: "حذف الحساب نهائياً" })).toBeVisible();
  });
});
