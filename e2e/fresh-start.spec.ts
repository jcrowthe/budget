import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { type FsPlan, plansApi, seedFreshStart } from "./support/fresh-start-seed";
import { mouseClick } from "./support/menu";
import { showOnlyPlans } from "./support/plans";
import { call, TODAY } from "./support/register-seed";

// EXF-478: Make a Fresh Start.

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const side = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Make a Fresh Start" });
const field = (page: Page) => dialog(page).getByRole("textbox", { name: "New Plan Name" });
const cont = (page: Page) => dialog(page).getByRole("button", { name: "Continue", exact: true });
const mmddyyyy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

async function open(
  page: Page,
  request: Parameters<typeof seedFreshStart>[0],
  newName = "ZZ-TEST FS never",
) {
  const s = await seedFreshStart(request);
  const other = await seedFreshStart(request);
  // Only this test's plans are listed: its two plans, the source's archive and the plan it makes.
  await showOnlyPlans(
    page,
    (p) =>
      p.id === s.plan ||
      p.id === other.plan ||
      p.name === newName ||
      p.name.startsWith(`${s.name} (Archived on `),
  );
  await page.goto(`/${s.plan}/budget`);
  await expect(side(page).getByRole("button", { name: s.name, exact: true })).toBeVisible();
  return { s, other };
}

async function openDialog(page: Page, s: FsPlan) {
  await mouseClick(page, side(page).getByRole("button", { name: s.name, exact: true }));
  const entry = page.getByRole("menuitem", { name: "Make a Fresh Start", exact: true });
  await expect(entry).toBeEnabled();
  await mouseClick(page, entry);
  await expect(dialog(page)).toBeVisible();
}

test("AC1: the menu entry opens the dialog with the ticket's copy; Cancel changes nothing", async ({
  page,
  request,
}) => {
  const { s } = await open(page, request);
  const mine = async () =>
    (await plansApi(request))
      .filter((p) => p.id === s.plan)
      .map((p) => ({ id: p.id, name: p.name }));
  const before = await mine();
  await openDialog(page, s);
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "Make a Fresh Start" })).toBeVisible();
  for (const t of [
    "Starting fresh will let you start planning from today without having to set up a brand new plan.",
    "Here's what you'll see in your Fresh Start:",
    "All your accounts. Linked accounts remain linked in the Fresh Start",
    "Today's balance for your linked accounts. Unlinked accounts will start with a $0 balance for you to update with today's balance",
    "Today's transactions in linked accounts",
    "Scheduled transactions",
    "Your category groups, categories, and targets",
    "Your archived plan will retain:",
    "Transaction histories for your accounts",
    "Category amounts",
    "New Plan Name",
    "Don't worry - you can always edit it later.",
    "A copy of this plan will be archived in case you're not happy with the changes.",
  ]) {
    await expect(d.getByText(t, { exact: true })).toBeVisible();
  }
  const box = d.getByRole("checkbox", { name: "Stop importing transactions in my archived plan" });
  await expect(box).toBeChecked();
  const info = d.getByRole("button", { name: "More about stopping imports" });
  await info.hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "If you plan to actively use both your Fresh Start plan and this archived plan, you may want to un-check this checkbox.",
  );
  await expect(d.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(field(page)).toHaveValue("");
  await expect(cont(page)).toBeDisabled();
  await mouseClick(page, d.getByRole("button", { name: "Cancel", exact: true }));
  await expect(dialog(page)).toHaveCount(0);
  expect(await mine()).toEqual(before);
  expect(before.map((p) => p.name)).toEqual([s.name]);
});

test("AC2: a name of an existing plan blocks Continue", async ({ page, request }) => {
  const { s, other } = await open(page, request);
  await openDialog(page, s);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("fresh-start")) posts.push(r.url());
  });
  for (const name of [s.name, `  ${other.name.toLowerCase()} `]) {
    await field(page).fill(name);
    await expect(
      dialog(page).getByText("The plan name already exists.", { exact: true }),
    ).toBeVisible();
    await expect(cont(page)).toBeDisabled();
    await mouseClick(page, cont(page), { allowDisabled: true });
  }
  await expect(dialog(page)).toBeVisible();
  expect(posts).toEqual([]);
});

test("AC3 + AC5: Continue opens a new plan with the structure and nothing else", async ({
  page,
  request,
}) => {
  const newName = testName("FS new");
  const { s } = await open(page, request, newName);
  await openDialog(page, s);
  await field(page).fill(newName);
  await expect(cont(page)).toBeEnabled();
  await mouseClick(page, cont(page));
  await expect(page).toHaveURL(
    (u) => /^\/[0-9a-f-]{36}\/budget$/.test(u.pathname) && !u.pathname.includes(s.plan),
  );
  const nid = page.url().split("/").slice(-2)[0] as string;
  expect(nid).not.toBe(s.plan);
  await expect(page).toHaveTitle(new RegExp(newName));
  await expect(side(page).getByRole("link", { name: /ZZ Checking/ })).toContainText("$0.00");
  await expect(side(page).getByRole("link", { name: /ZZ Card/ })).toContainText("$0.00");
  await expect(page.locator(".group-name", { hasText: "ZZ Fresh Group" })).toBeVisible();
  await expect(page.locator(".category-name", { hasText: "ZZ Rent" })).toBeVisible();
  await expect(page.locator(".category-name", { hasText: "ZZ Food" })).toBeVisible();
  const month = await call(request, "GET", `/api/v1/budgets/${nid}/months/${TODAY.slice(0, 7)}-01`);
  const cats = month.groups.flatMap((g: { categories: { assigned: number }[] }) => g.categories);
  expect(cats.every((c: { assigned: number }) => c.assigned === 0)).toBe(true);
  await side(page)
    .getByRole("link", { name: /ZZ Checking/ })
    .click();
  const rows = page.getByRole("row").filter({ hasText: "Starting Balance" });
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "ZZ Grocer" })).toHaveCount(0);
  // A zero amount shows as an empty cell; the API and the balances say $0.00.
  await expect(rows).not.toContainText("$");
  await expect(page.getByText("$0.00", { exact: true }).first()).toBeVisible();
  const own = (
    await call(
      request,
      "GET",
      `/api/v1/budgets/${nid}/accounts/${page.url().split("/").pop()}/transactions`,
    )
  ).transactions as { amount: number; date: string; payee_name: string }[];
  expect(own.map((t) => [t.payee_name, t.amount, t.date])).toEqual([
    ["Starting Balance", 0, TODAY],
  ]);
  await expect(rows).toContainText(mmddyyyy(TODAY));
  const sched = (await call(request, "GET", `/api/v1/budgets/${nid}/scheduled-transactions`))
    .scheduled_transactions as {
    memo: string | null;
    mirror: boolean;
    subtransactions: unknown[];
  }[];
  expect(
    sched
      .filter((x) => !x.mirror)
      .map((x) => x.memo)
      .sort(),
  ).toEqual(["ZZ split", "ZZ transfer"]);
  expect(sched.find((x) => x.memo === "ZZ split")?.subtransactions).toHaveLength(2);
  const payees = (await call(request, "GET", `/api/v1/budgets/${nid}/payees`)).payees as {
    name: string;
  }[];
  expect(payees.some((p) => p.name === "ZZ Grocer")).toBe(true);
  const rent = month.groups
    .flatMap(
      (g: { categories: { name: string; target: unknown; note: string | null }[] }) => g.categories,
    )
    .find((c: { name: string }) => c.name === "ZZ Rent");
  expect(rent.target).toBeTruthy();
  expect(rent.note).toBe("ZZ rent note");
});

test("AC4: the archive is in Recent Plans and the plans list and keeps its history", async ({
  page,
  request,
}) => {
  const newName = testName("FS new");
  const { s } = await open(page, request, newName);
  await openDialog(page, s);
  await field(page).fill(newName);
  await mouseClick(page, cont(page));
  await expect(page).toHaveTitle(new RegExp(newName));
  const archived = `${s.name} (Archived on ${TODAY})`;
  await mouseClick(page, side(page).getByRole("button", { name: newName, exact: true }));
  await mouseClick(page, page.getByRole("menuitem", { name: "Open Plan", exact: true }));
  const sub = page.getByRole("menu", { name: "Plans", exact: true });
  await expect(sub.getByRole("menuitem", { name: archived, exact: true })).toBeVisible();
  await mouseClick(page, sub.getByRole("menuitem", { name: "View All Plans", exact: true }));
  await expect(page.getByText(archived, { exact: true })).toBeVisible();
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(page.getByRole("row").filter({ hasText: "ZZ Grocer" })).toHaveCount(2);
  await expect(page.getByRole("row").filter({ hasText: "Starting Balance" })).toHaveCount(1);
  const month = await call(
    request,
    "GET",
    `/api/v1/budgets/${s.plan}/months/${TODAY.slice(0, 7)}-01`,
  );
  const rent = month.groups
    .flatMap((g: { categories: { name: string; assigned: number }[] }) => g.categories)
    .find((c: { name: string }) => c.name === "ZZ Rent");
  expect(rent.assigned).toBe(100_000);
});
