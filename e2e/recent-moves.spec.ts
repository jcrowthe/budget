import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { monthIso, Plan } from "./support/plan-seed";
import { realClick } from "./support/real-click";

const RENT = "🏠 Rent/Mortgage";
const GROC = "🛒 Groceries";
const FUN = "🍿 Entertainment";
const TOOLTIP = "Previous 34 days of assigning and moving money";
const RTA = "ready_to_assign";

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
const recentBtn = (page: Page) => page.getByRole("button", { name: "Recent Moves", exact: true });
const panel = (page: Page) => page.getByRole("dialog", { name: "Recent Moves", exact: true });
const tab = (page: Page, name: string) => panel(page).getByRole("tab", { name, exact: true });
const cards = (page: Page) => panel(page).getByRole("listitem");
const undoBtn = (page: Page) => page.getByRole("button", { name: "Undo", exact: true });
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });

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
const today = () =>
  new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const thisMonth = () =>
  new Date(`${monthIso(0)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

async function seedThree(page: Page) {
  await plan.create("recent-moves");
  await plan.inflow(2000);
  await open(page);
  await typeAssigned(page, RENT, "450");
  await expect(catRow(page, RENT).locator(".assigned-box .amount")).toHaveText("$450.00");
  await apiMove(RENT, GROC, 100);
  await apiMove(RENT, RTA, 25);
}

test("1 lists an edit, a move and a removal under today, newest first, with the actor", async ({
  page,
}) => {
  await seedThree(page);
  const me = (await (await request.get("/api/v1/me", { headers: await authHeaders() })).json()).data
    .email as string;
  const name = me.split("@")[0] as string;
  await recentBtn(page).click();
  await expect(panel(page)).toBeVisible();
  const heading = panel(page).getByRole("heading", { name: new RegExp(today()) });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText("Today");
  await expect(panel(page).getByRole("heading", { level: 3 })).toHaveCount(1);
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).nth(0)).toContainText(`${name} removed $25.00 from`);
  await expect(cards(page).nth(0).getByRole("button")).toContainText(
    `Rent/Mortgage ${thisMonth()}`,
  );
  await expect(cards(page).nth(1)).toContainText(`${name} moved $100.00 from`);
  await expect(cards(page).nth(1)).toContainText("Groceries");
  await expect(cards(page).nth(2)).toContainText(`${name} assigned $450.00 to`);
  for (let i = 0; i < 3; i++) {
    await expect(cards(page).nth(i).locator(".recent-move-avatar")).toHaveText(
      name.charAt(0).toUpperCase(),
    );
  }
});

test("2 the Moved and Assigned tabs split the entries", async ({ page }) => {
  await seedThree(page);
  await apiMove(RTA, FUN, 10);
  await recentBtn(page).click();
  await expect(cards(page)).toHaveCount(4);
  await tab(page, "Moved").click();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toContainText("removed $25.00 from");
  await expect(cards(page).nth(1)).toContainText("moved $100.00 from");
  await tab(page, "Assigned").click();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toContainText("assigned $10.00 to");
  await expect(cards(page).nth(0)).toContainText("Entertainment");
  await expect(cards(page).nth(1)).toContainText("assigned $450.00 to");
  await tab(page, "All").click();
  await expect(cards(page)).toHaveCount(4);
});

test("3 clicking a month chip closes the panel, opens that month and selects the category", async ({
  page,
}) => {
  await plan.create("recent-moves");
  await plan.inflow(2000);
  await open(page);
  await plan.assign(GROC, 300, 1);
  await apiMove(GROC, FUN, 50, 1);
  await recentBtn(page).click();
  const next = monthIso(1);
  const chip = cards(page)
    .first()
    .getByRole("button", { name: /Entertainment/ });
  await chip.click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page).toHaveURL(`/${plan.id}/budget/${next.slice(0, 7).replace("-", "")}`);
  await expect(catRow(page, FUN)).toHaveAttribute("aria-selected", "true");
});

test("4 shows the empty states", async ({ page }) => {
  await plan.create("recent-moves");
  await open(page);
  await recentBtn(page).click();
  await expect(panel(page)).toContainText("No recent moves");
  await expect(panel(page)).toContainText(
    "Assigning and moving money in the last 34 days shows up here.",
  );
  await expect(panel(page).getByRole("button", { name: "Close", exact: true })).toBeVisible();
  await panel(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await plan.inflow(1000);
  await plan.assign(RENT, 100);
  await page.reload();
  await recentBtn(page).click();
  await expect(cards(page)).toHaveCount(1);
  await tab(page, "Moved").click();
  await expect(panel(page)).toContainText("No moved money in the last 34 days");
  await expect(cards(page)).toHaveCount(0);
});

test("5 focus starts on All, Tab stays inside, Escape returns focus to the button", async ({
  page,
}) => {
  await seedThree(page);
  await recentBtn(page).click();
  await expect(tab(page, "All")).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
      true,
    );
  }
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(recentBtn(page)).toBeFocused();
});

test("6 lists a new move and an undo the next time it is opened", async ({ page }) => {
  await plan.create("recent-moves");
  await plan.inflow(2000);
  await plan.assign(RENT, 450);
  await open(page);
  await recentBtn(page).click();
  await expect(cards(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  await realClick(page, catRow(page, RENT).locator(".available-pill"));
  const dlg = page.getByRole("dialog", { name: "Move money", exact: true });
  await dlg.getByRole("textbox", { name: "Amount", exact: true }).fill("40");
  await realClick(page, dlg.getByRole("combobox", { name: "To", exact: true }));
  await realClick(page, page.getByRole("option").filter({ hasText: GROC }).first());
  await realClick(page, dlg.getByRole("button", { name: "OK", exact: true }));
  await expect(dlg).toHaveCount(0);
  await recentBtn(page).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toContainText("moved $40.00 from");
  await page.keyboard.press("Escape");

  const undone = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/changes\/.+\/undo$/.test(r.url()),
  );
  await undoBtn(page).click();
  await undone;
  await recentBtn(page).click();
  await expect(cards(page)).toHaveCount(3);
  const back = cards(page).nth(0);
  await expect(back).toContainText("Undo");
  await expect(back).toContainText("moved $40.00 from");
  await expect(back.getByRole("button").first()).toContainText("Groceries");
  await expect(back.getByRole("button").nth(1)).toContainText("Rent/Mortgage");
});

test("8 a redo of a move reads Redo, not Undo", async ({ page }) => {
  await plan.create("recent-moves");
  await plan.inflow(2000);
  await plan.assign(RENT, 450);
  await open(page);
  await realClick(page, catRow(page, RENT).locator(".available-pill"));
  const dlg = page.getByRole("dialog", { name: "Move money", exact: true });
  await dlg.getByRole("textbox", { name: "Amount", exact: true }).fill("40");
  await realClick(page, dlg.getByRole("combobox", { name: "To", exact: true }));
  await realClick(page, page.getByRole("option").filter({ hasText: GROC }).first());
  await realClick(page, dlg.getByRole("button", { name: "OK", exact: true }));
  await expect(dlg).toHaveCount(0);
  for (const name of ["Undo", "Redo"]) {
    const done = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/changes\/.+\/undo$/.test(r.url()),
    );
    await page.getByRole("button", { name, exact: true }).click();
    await done;
  }
  await recentBtn(page).click();
  await expect(cards(page)).toHaveCount(4);
  const back = cards(page).nth(0);
  await expect(back).toContainText("Redo");
  await expect(back).not.toContainText("Undo");
  await expect(back).toContainText("moved $40.00 from");
  await expect(back.getByRole("button").first()).toContainText("Rent/Mortgage");
  await expect(back.getByRole("button").nth(1)).toContainText("Groceries");
  await expect(cards(page).nth(1)).toContainText("Undo");
});

test("7 the toolbar keeps its order, its tooltip and the Undo/Redo states", async ({ page }) => {
  await plan.create("recent-moves");
  await plan.inflow(1000);
  await open(page);
  const labels = await page
    .locator(".grid-toolbar > button")
    .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
  expect(labels).toEqual(["Category Group", "Undo", "Redo", "Recent Moves"]);
  await expect(recentBtn(page)).toHaveAttribute("title", TOOLTIP);
  await expect(recentBtn(page)).toBeEnabled();
  await expect(undoBtn(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  await typeAssigned(page, RENT, "20");
  await expect(undoBtn(page)).toBeEnabled();
  await recentBtn(page).click();
  await page.keyboard.press("Escape");
  await expect(undoBtn(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
});
