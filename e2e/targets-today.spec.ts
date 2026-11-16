import { expect, test } from "./fixtures";
import { openPlan, RENT, removePlan, row, type Seed, seedPlan } from "./plan-panel.fixtures";
import {
  card,
  firstOfMonth,
  form,
  lastOfMonth,
  ordinal,
  readCategory,
  realClick,
} from "./targets.fixtures";

// The owner's date decides: on the last evening of a month, in a time zone behind UTC, the server's own date
// is already the next month. The clock is fixed at 05:00 UTC on the first day after the current UTC month M,
// which is 21:00 or 22:00 on M's last day in Los Angeles.
test.use({ timezoneId: "America/Los_Angeles" });

let s: Seed;
test.beforeEach(async ({ request }) => {
  s = await seedPlan(request, "target-today");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

test("a target made on a month's last evening belongs to that month", async ({ page, request }) => {
  const now = new Date().toISOString().slice(0, 10);
  const month = firstOfMonth(now);
  const last = lastOfMonth(now);
  const next = firstOfMonth(now, 1);
  await page.clock.setFixedTime(new Date(`${next}T05:00:00Z`).getTime());
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await realClick(page, card(page).getByRole("button", { name: "Create Target" }));
  await form(page).getByRole("textbox", { name: "Target Amount" }).fill("100");
  await form(page).getByRole("textbox", { name: "Target Amount" }).press("Tab");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().includes("/target"));
  const reread = page.waitForRequest(
    (r) =>
      r.method() === "GET" &&
      /\/months\/\d{4}-\d{2}-01\?/.test(r.url()) &&
      r.url().includes(`today=${last}`),
  );
  await realClick(page, form(page).getByRole("button", { name: "Save Target" }));
  const sent = await put;
  expect(new URL(sent.url()).searchParams.get("today")).toBe(last);
  const response = await sent.response();
  if (!response) throw new Error("no response");
  expect((await response.json()).data.target.created_month).toBe(month);
  await reread;
  await expect
    .poll(
      async () =>
        (await readCategory(request, s, RENT, month, last))?.target?.definition?.created_on,
    )
    .toBe(last);
  await expect(row(page, RENT).locator(".status-label")).toHaveText(
    `$100.00 more needed by the ${ordinal(Number(last.slice(8)))}`,
  );
});
