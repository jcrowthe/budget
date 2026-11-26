import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { delayRoute } from "./support/delay-route";

const pad = (n: number) => String(n).padStart(2, "0");
const at = (delta: number) => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};
const M = at(0);
const M1 = at(1);
const NOTE = "ZZ-TEST saved note";

const created: string[] = [];
async function newPlan(request: APIRequestContext) {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("note-load") },
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

const apiNote = async (request: APIRequestContext, id: string, iso: string) =>
  (
    await (
      await request.get(`/api/v1/budgets/${id}/months/${iso}`, { headers: await authHeaders() })
    ).json()
  ).data.note as string | null;

const noteButton = (page: Page) => page.locator(".month-note");
const field = (page: Page) => page.getByRole("textbox", { name: "Month note", exact: true });

/** Presses the note button the moment it can be pressed, then OKs whatever the popover shows. */
async function pressAndOk(page: Page) {
  await noteButton(page).waitFor();
  await noteButton(page)
    .click({ timeout: 5_000 })
    .catch(() => {});
  return field(page);
}

test("1 a note pressed while the month loads is never overwritten", async ({ page, request }) => {
  const id = await newPlan(request);
  const set = await request.patch(`/api/v1/budgets/${id}/months/${M}`, {
    headers: await authHeaders(),
    data: { note: NOTE },
  });
  expect(set.ok()).toBe(true);
  await delayRoute(page, (url) => url.pathname.endsWith(`/months/${M}`), 2_000);
  await page.goto(`/${id}/budget`);
  const box = await pressAndOk(page);
  await expect(box).toHaveValue(NOTE);
  await page.locator(".month-note-ok").click();
  await expect(box).toHaveCount(0);
  await expect(noteButton(page)).toHaveText(NOTE);
  expect(await apiNote(request, id, M)).toBe(NOTE);
});

test("2 after Next month the popover never shows or writes last month's note", async ({
  page,
  request,
}) => {
  const id = await newPlan(request);
  await request.patch(`/api/v1/budgets/${id}/months/${M}`, {
    headers: await authHeaders(),
    data: { note: NOTE },
  });
  await page.goto(`/${id}/budget`);
  await expect(noteButton(page)).toHaveText(NOTE);
  await delayRoute(page, (url) => url.pathname.endsWith(`/months/${M1}`), 2_000);
  await page.getByRole("button", { name: "Next month" }).click();
  const box = await pressAndOk(page);
  if (await box.count()) {
    await expect(box).not.toHaveValue(NOTE);
    await page.locator(".month-note-ok").click();
  }
  await expect(noteButton(page)).toHaveText("Enter a note...");
  expect(await apiNote(request, id, M1)).toBeNull();
  expect(await apiNote(request, id, M)).toBe(NOTE);
});
