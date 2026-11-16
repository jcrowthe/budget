import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

const pad = (n: number) => String(n).padStart(2, "0");
const at = (delta: number) => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + delta, 1);
  return {
    key: `${d.getFullYear()}${pad(d.getMonth() + 1)}`,
    iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`,
  };
};
const label = (key: string) =>
  new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4)) - 1, 1)).toLocaleDateString(
    "en-US",
    { month: "short", year: "numeric", timeZone: "UTC" },
  );
const M = at(0);
const M1 = at(1);
const NOTE = "ZZ-TEST note for this month, long enough to be cut";
const NEXT_TITLE = "Before you can move to next month, you need to assign money this month.";

const created: string[] = [];
async function newPlan(request: APIRequestContext) {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("nav") },
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

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const prev = (page: Page) => page.getByRole("button", { name: "Previous month" });
const next = (page: Page) => page.getByRole("button", { name: "Next month" });
const today = (page: Page) => page.getByRole("button", { name: "Today" });
const noteLine = (page: Page) => page.locator(".month-note");

test("1 arrows change the month and the URL; a month in the URL loads", async ({
  page,
  request,
}) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await expect(next(page)).toBeEnabled();
  const gridRead = page.waitForRequest(`**/api/v1/budgets/${id}/months/${M1.iso}`);
  await next(page).click();
  await gridRead;
  await expect(page).toHaveURL(`/${id}/budget/${M1.key}`);
  await expect(h1(page)).toHaveText(label(M1.key));
  await prev(page).click();
  await expect(page).toHaveURL(`/${id}/budget/${M.key}`);
  await expect(h1(page)).toHaveText(label(M.key));
  await page.goto(`/${id}/budget/${at(-3).key}`);
  await expect(h1(page)).toHaveText(label(at(-3).key));
  await expect(page).toHaveURL(`/${id}/budget/${at(-3).key}`);
});

test("2 Back and Forward walk the months", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await page.evaluate(() => {
    (window as unknown as { __m: number }).__m = 1;
  });
  await next(page).click();
  await today(page).click();
  await next(page).click();
  await expect(h1(page)).toHaveText(label(M1.key));
  await page.goBack();
  await expect(h1(page)).toHaveText(label(M.key));
  await page.goBack();
  await expect(h1(page)).toHaveText(label(M1.key));
  await page.goBack();
  await expect(page).toHaveURL(`/${id}/budget`);
  await page.goForward();
  await expect(page).toHaveURL(`/${id}/budget/${M1.key}`);
  expect(await page.evaluate(() => (window as unknown as { __m?: number }).__m)).toBe(1);
});

test("3 Today shows only on other months", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await expect(h1(page)).toHaveText(label(M.key));
  await expect(today(page)).toHaveCount(0);
  await page.goto(`/${id}/budget/${M1.key}`);
  await today(page).click();
  await expect(page).toHaveURL(`/${id}/budget/${M.key}`);
  await expect(today(page)).toHaveCount(0);
  await page.goto(`/${id}/budget/${at(-2).key}`);
  await expect(today(page)).toBeVisible();
});

test("4 limits on a new plan", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await expect(prev(page)).toBeDisabled();
  await next(page).click();
  await expect(next(page)).toBeDisabled();
  await expect(next(page)).toHaveAttribute("title", NEXT_TITLE);
  await expect(prev(page)).toBeEnabled();
  await page.goto(`/${id}/budget/${at(3).key}`);
  await expect(h1(page)).toHaveText(label(at(3).key));
  await expect(next(page)).toBeDisabled();
  await expect(prev(page)).toBeEnabled();
});

test("5 an assignment later than the limit opens one more month", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.route("**/api/v1/budgets/*/month-range", (r) =>
    r.fulfill({ json: { data: { first_month: M.iso, last_assigned_month: M1.iso } } }),
  );
  await page.goto(`/${id}/budget/${M1.key}`);
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  await expect(h1(page)).toHaveText(label(at(2).key));
  await expect(next(page)).toBeDisabled();
});

test("6 month picker", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  const button = page.getByRole("button", { name: label(M.key) });
  await button.click();
  const dlg = page.getByRole("dialog", { name: "Choose month" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button", { name: label(M.key) })).toHaveClass(/is-selected/);
  await expect(dlg.getByRole("button", { name: label(M.key) })).toHaveClass(/is-current/);
  await expect(dlg.getByRole("button", { name: label(M1.key) })).toBeEnabled();
  await expect(dlg.getByRole("button", { name: label(at(-1).key) })).toBeDisabled();
  await dlg.getByRole("button", { name: "Previous Year" }).click();
  await expect(dlg.locator(".picker-month:not(:disabled)")).toHaveCount(0);
  await dlg.getByRole("button", { name: "Next Year" }).click();
  await dlg.getByRole("button", { name: "Next Year" }).click();
  // The year after M's: only January is allowed, and only when M is December (M+1 is the furthest month).
  await expect(dlg.locator(".picker-month:not(:disabled)")).toHaveCount(
    M1.iso.slice(0, 4) === M.iso.slice(0, 4) ? 0 : 1,
  );
  await dlg.getByRole("button", { name: "Previous Year" }).click();
  await dlg.getByRole("button", { name: label(M1.key) }).click();
  await expect(page).toHaveURL(`/${id}/budget/${M1.key}`);
  await expect(dlg).toHaveCount(0);
  await page.getByRole("button", { name: label(M1.key) }).click();
  await expect(dlg).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(page.getByRole("button", { name: label(M1.key) })).toBeFocused();
  await page.getByRole("button", { name: label(M1.key) }).click();
  await page.mouse.click(1000, 500);
  await expect(dlg).toHaveCount(0);
});

test("7 header look", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget/${M1.key}`);
  await expect(prev(page)).toBeEnabled(); // the limits have loaded
  await expect(next(page)).toBeDisabled();
  const style = (l: ReturnType<typeof next>, prop: string) =>
    l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  // Source (Nov 2026, dark theme, 1600x813): arrow 40x30, rgb(117,131,255); disabled rgb(56,60,163).
  expect(await style(prev(page), "color")).toBe("rgb(117, 131, 255)");
  expect(await style(next(page), "color")).toBe("rgb(56, 60, 163)");
  const box = await prev(page).boundingBox();
  expect([box?.width, box?.height]).toEqual([40, 30]);
  // Source note line: 14px, rgb(196,197,207), max-width 112px.
  expect(await style(noteLine(page), "color")).toBe("rgb(196, 197, 207)");
  expect(await style(noteLine(page), "max-width")).toBe("112px");
  expect(await style(noteLine(page), "font-size")).toBe("14px");
});

test("8 a note saved with Enter persists, truncated, per month", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await expect(noteLine(page)).toHaveText("Enter a note...");
  await noteLine(page).click();
  const box = page.getByRole("textbox", { name: "Month note" });
  await expect(box).toBeFocused();
  await box.fill(NOTE);
  await box.press("Enter");
  await expect(page.getByRole("dialog", { name: "Month note" })).toHaveCount(0);
  const check = async () => {
    await expect(noteLine(page)).toHaveText(NOTE);
    await expect(noteLine(page)).toHaveAttribute("title", NOTE);
    const r = await noteLine(page).evaluate((el) => ({
      overflow: getComputedStyle(el).textOverflow,
      cut: el.scrollWidth > el.clientWidth,
    }));
    expect(r).toEqual({ overflow: "ellipsis", cut: true });
  };
  await check();
  await page.reload();
  await check();
  await next(page).click();
  await expect(noteLine(page)).toHaveText("Enter a note...");
  await prev(page).click();
  await check();
  const res = await request.get(`/api/v1/budgets/${id}/months/${M.iso}`, {
    headers: await authHeaders(),
  });
  expect((await res.json()).data.note).toBe(NOTE);
});

test("9 note keys: Shift+Enter, Escape, outside, OK, whitespace clears", async ({
  page,
  request,
}) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  const dlg = page.getByRole("dialog", { name: "Month note" });
  const box = page.getByRole("textbox", { name: "Month note" });
  await noteLine(page).click();
  await box.fill("one");
  await box.press("Shift+Enter");
  await expect(dlg).toBeVisible();
  await box.pressSequentially("two");
  expect(await box.inputValue()).toBe("one\ntwo");
  const height = () => box.evaluate((el) => el.getBoundingClientRect().height);
  // Source: 44px at first, grows with the text, capped at 168px.
  for (let i = 0; i < 3; i++) await box.press("Shift+Enter");
  await box.pressSequentially("x");
  expect(await height()).toBeGreaterThan(44);
  for (let i = 0; i < 15; i++) await box.press("Shift+Enter");
  await box.pressSequentially("x");
  expect(await height()).toBe(168);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(noteLine(page)).toHaveText("Enter a note...");
  await expect(noteLine(page)).toBeFocused();
  await noteLine(page).click();
  await box.fill("discarded");
  await page.mouse.click(1000, 500);
  await expect(dlg).toHaveCount(0);
  await expect(noteLine(page)).toHaveText("Enter a note...");
  await noteLine(page).click();
  await box.fill("kept");
  await dlg.getByRole("button", { name: "OK" }).click();
  await expect(noteLine(page)).toHaveText("kept");
  await noteLine(page).click();
  await box.fill("   ");
  await box.press("Enter");
  await expect(noteLine(page)).toHaveText("Enter a note...");
  await expect
    .poll(async () => {
      const res = await request.get(`/api/v1/budgets/${id}/months/${M.iso}`, {
        headers: await authHeaders(),
      });
      return (await res.json()).data.note;
    })
    .toBeNull();
});

test("10 note popover look on an empty month", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await expect(noteLine(page)).toHaveText("Enter a note...");
  await noteLine(page).click();
  const dlg = page.getByRole("dialog", { name: "Month note" });
  const box = page.getByRole("textbox", { name: "Month note" });
  await expect(box).toBeFocused();
  await expect(dlg.getByRole("button", { name: "OK" })).toBeVisible();
  const style = (prop: string) =>
    box.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  // Source (design doc, Acceptance case 10): popover 224px wide; textarea 44px,
  // background rgb(60,62,83), border rgb(114,116,132).
  expect((await dlg.boundingBox())?.width).toBe(224);
  expect((await box.boundingBox())?.height).toBe(44);
  expect(await style("background-color")).toBe("rgb(60, 62, 83)");
  expect(await style("border-top-color")).toBe("rgb(114, 116, 132)");
  // Source (case 10): the popover sits under the note line.
  const line = await noteLine(page).boundingBox();
  const pop = await dlg.boundingBox();
  expect(pop?.y).toBeGreaterThanOrEqual((line?.y ?? 0) + (line?.height ?? 0));
  const lineMid = (line?.x ?? 0) + (line?.width ?? 0) / 2;
  expect(lineMid).toBeGreaterThanOrEqual(pop?.x ?? 0);
  expect(lineMid).toBeLessThanOrEqual((pop?.x ?? 0) + (pop?.width ?? 0));
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
});
