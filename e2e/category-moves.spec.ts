import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { monthIso, Plan } from "./support/plan-seed";
import { realClick } from "./support/real-click";

const RENT = "🏠 Rent/Mortgage";
const GROC = "🛒 Groceries";
const FUN = "🍿 Entertainment";
const UTIL = "📱 Phone & Internet";
const RTA = "ready_to_assign";
const TITLE = "Changes to your assigned amount this month";

type Req = import("@playwright/test").APIRequestContext;
let plan: Plan;
let request: Req;
test.beforeEach(async ({ request: r }: { request: Req }) => {
  request = r;
  plan = new Plan(r);
});
test.afterEach(async () => {
  if (plan.id) await plan.remove();
});

const open = async (page: Page) => {
  await page.goto(`/${plan.id}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(
    page.locator(".rta-box.is-positive, .rta-box.is-zero, .rta-box.is-negative"),
  ).toBeVisible();
};
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
const clock = (page: Page, name: string) =>
  page.getByRole("button", { name: `Moves for ${name}`, exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Moves", exact: true });

async function apiMove(from: string, to: string, dollars: number, offset = 0) {
  const f = from === RTA ? RTA : (await plan.cat(from, offset)).id;
  const t = to === RTA ? RTA : (await plan.cat(to, offset)).id;
  const res = await request.post(`/api/v1/budgets/${plan.id}/months/${monthIso(offset)}/moves`, {
    headers: await authHeaders(),
    data: { from: f, to: t, amount: dollars * 1000 },
  });
  expect(res.status()).toBe(200);
}
async function typeAssigned(page: Page, name: string, text: string) {
  await catRow(page, name).locator(".assigned-box .amount").click();
  await page.keyboard.type(text);
  const done = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/months\/.+\/categories\//.test(r.url()),
  );
  await page.getByRole("textbox", { name: `Assigned for ${name}` }).press("Enter");
  await done;
}
// The default plan date format, MM/DD/YYYY, of the browser's local day.
const todayText = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
};
const rows = (page: Page) =>
  dialog(page)
    .getByRole("row")
    .filter({ hasNot: page.getByRole("columnheader") });

test("AC4 the clock appears only on categories with moves this month and opens the Moves table with deltas", async ({
  page,
}) => {
  await plan.create("category-moves");
  await plan.inflow(2000);
  await open(page);
  await typeAssigned(page, RENT, "450");
  await expect(catRow(page, RENT).locator(".assigned-box .amount")).toHaveText("$450.00");
  await typeAssigned(page, RENT, "300");
  await expect(catRow(page, RENT).locator(".assigned-box .amount")).toHaveText("$300.00");
  await apiMove(RENT, GROC, 100);
  await apiMove(RTA, FUN, 30, 1);
  await page.reload();
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();

  await expect(clock(page, RENT)).toBeVisible();
  await expect(clock(page, RENT)).toHaveAttribute("title", TITLE);
  await expect(clock(page, GROC)).toBeVisible();
  await expect(clock(page, FUN)).toHaveCount(0);
  await expect(clock(page, UTIL)).toHaveCount(0);

  await realClick(page, clock(page, RENT));
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("heading", { name: "Moves", exact: true })).toBeVisible();
  await expect(dialog(page)).toContainText(RENT);
  for (const h of ["DATE", "MOVE", "AMOUNT"]) {
    await expect(dialog(page).getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  }
  const me = (await (await request.get("/api/v1/me", { headers: await authHeaders() })).json()).data
    .email as string;
  const initial = (me.split("@")[0] as string).charAt(0).toUpperCase();
  const body = dialog(page).getByRole("row").filter({ hasText: "$" });
  await expect(body).toHaveCount(4);
  const want: [string, string][] = [
    [`Moved to ${GROC}`, "−$100.00"],
    ["Removed", "−$150.00"],
    ["Assigned", "$450.00"],
  ];
  // newest first: the move, the 450 → 300 edit (removed 150), the 0 → 450 edit
  await expect(body.nth(0)).toContainText(want[0]?.[0] as string);
  await expect(body.nth(0)).toContainText(want[0]?.[1] as string);
  await expect(body.nth(1)).toContainText("Removed");
  await expect(body.nth(1)).toContainText("−$150.00");
  await expect(body.nth(2)).toContainText("Assigned");
  await expect(body.nth(2)).toContainText("$450.00");
  await expect(body.nth(0)).toContainText(todayText());
  await expect(body.nth(0)).toContainText(initial);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(clock(page, RENT)).toBeFocused();

  await page.getByRole("button", { name: "Next month" }).click();
  await expect(clock(page, FUN)).toBeVisible();
  await expect(clock(page, RENT)).toHaveCount(0);
});

test("Escape closes and returns focus; the icon and the table refresh after a move, an undo and a redo", async ({
  page,
}) => {
  await plan.create("category-moves");
  await plan.inflow(2000);
  await plan.assign(RENT, 450);
  await plan.assign(GROC, 100);
  await apiMove(GROC, RTA, 10);
  await open(page);
  await clock(page, GROC).focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(clock(page, GROC)).toBeFocused();
  await expect(clock(page, FUN)).toHaveCount(0);

  await realClick(page, catRow(page, RENT).locator(".available-pill"));
  const dlg = page.getByRole("dialog", { name: "Move money", exact: true });
  await dlg.getByRole("textbox", { name: "Amount", exact: true }).fill("20");
  await realClick(page, dlg.getByRole("combobox", { name: "To", exact: true }));
  await realClick(page, page.getByRole("option").filter({ hasText: FUN }).first());
  await realClick(page, dlg.getByRole("button", { name: "OK", exact: true }));
  await expect(dlg).toHaveCount(0);
  await expect(clock(page, FUN)).toBeVisible();
  await realClick(page, clock(page, FUN));
  await expect(rows(page).nth(0)).toBeVisible();
  await expect(dialog(page)).toContainText(`Moved from ${RENT}`);
  await expect(dialog(page)).toContainText("$20.00");
  await page.keyboard.press("Escape");

  const step = async (name: "Undo" | "Redo", re: RegExp) => {
    const done = page.waitForResponse((r) => r.request().method() === "POST" && re.test(r.url()));
    await page.getByRole("button", { name, exact: true }).click();
    await done;
    await realClick(page, clock(page, FUN));
    await expect(dialog(page).getByRole("row").filter({ hasText: "$20.00" }).first()).toContainText(
      name,
    );
    await page.keyboard.press("Escape");
  };
  await step("Undo", /\/changes\/.+\/undo$/);
  await step("Redo", /\/changes\/.+\/undo$/);
});
