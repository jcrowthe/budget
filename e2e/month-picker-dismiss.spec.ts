import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";

// EXF-727: a press outside a popover closes it even when the press lands on a disabled button
// (Chromium sends no mousedown to a disabled control; the hook listens for pointerdown).

const pad = (n: number) => String(n).padStart(2, "0");
const d1 = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
const M1 = {
  key: `${d1.getFullYear()}${pad(d1.getMonth() + 1)}`,
  iso: `${d1.getFullYear()}-${pad(d1.getMonth() + 1)}-01`,
  label: d1.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
};

const created: string[] = [];
async function newPlan(request: APIRequestContext) {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("month-picker-dismiss") },
  });
  const id = (await res.json()).data.budget.id as string;
  created.push(id);
  return id;
}
test.afterEach(async ({ request }) => {
  for (const id of created.splice(0)) {
    await request.delete(`/api/v1/budgets/${id}`, { headers: await authHeaders() });
  }
});

const picker = (page: Page) => page.getByRole("dialog", { name: "Choose month", exact: true });
const note = (page: Page) => page.getByRole("dialog", { name: "Month note", exact: true });
const next = (page: Page) => page.getByRole("button", { name: "Next month", exact: true });
const monthButton = (page: Page) => page.getByRole("button", { name: M1.label, exact: true });

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
]) {
  test.describe(`outside press on a disabled button, ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test("1. a click on a disabled button outside closes the month picker", async ({
      page,
      request,
    }) => {
      const id = await newPlan(request);
      await page.goto(`/${id}/budget/${M1.key}`);
      await expect(next(page)).toBeDisabled();
      await realClick(page, monthButton(page));
      await expect(picker(page)).toBeVisible();
      await realClick(page, next(page), { allowDisabled: true });
      await expect(picker(page)).toHaveCount(0);
      await expect(page).toHaveURL(`/${id}/budget/${M1.key}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(M1.label);
      await expect(next(page)).toBeDisabled();
    });

    test("3. a click on a disabled button outside closes the month note", async ({
      page,
      request,
    }) => {
      const id = await newPlan(request);
      await page.goto(`/${id}/budget/${M1.key}`);
      await expect(next(page)).toBeDisabled();
      await realClick(page, page.locator(".month-note"));
      await expect(note(page)).toBeVisible();
      await realClick(page, next(page), { allowDisabled: true });
      await expect(note(page)).toHaveCount(0);
      await expect(page).toHaveURL(`/${id}/budget/${M1.key}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(M1.label);
      await expect(next(page)).toBeDisabled();
    });
  });
}

test.describe("outside press on an option still loading, 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("2. a press on an Auto-Assign option still loading closes the month picker", async ({
    page,
    request,
  }) => {
    const id = await newPlan(request);
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    // Only delays the real server's answer; nothing is stood in.
    await page.route(`**/api/v1/budgets/${id}/months/${M1.iso}/auto-assign?**`, async (route) => {
      if (route.request().method() === "GET") await held;
      await route.fallback();
    });
    await page.goto(`/${id}/budget/${M1.key}`);
    const option = page.locator(".auto-assign-option").first();
    await expect(option).toBeDisabled();
    await realClick(page, monthButton(page));
    await expect(picker(page)).toBeVisible();
    await realClick(page, option, { allowDisabled: true });
    await expect(picker(page)).toHaveCount(0);
    release();
    await expect(option).toBeEnabled();
    await expect(picker(page)).toHaveCount(0);
  });
});
