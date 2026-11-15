import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const M = `${now.getFullYear()}${pad(now.getMonth() + 1)}`;
const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const M1 = `${next.getFullYear()}${pad(next.getMonth() + 1)}`;
const monthLabel = (key: string) =>
  new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4)) - 1, 1)).toLocaleDateString(
    "en-US",
    { month: "short", year: "numeric", timeZone: "UTC" },
  );
const NO_ACCOUNT = "00000000-0000-0000-0000-000000000000";
const REPORTS: [string, string][] = [
  ["spending-breakdown", "Spending Breakdown"],
  ["spending-trends", "Spending Trends"],
  ["net-worth", "Net Worth Report"],
  ["income-expense", "Income v Expense Report"],
  ["age-of-money", "Age Of Money"],
];

async function newPlan(request: import("@playwright/test").APIRequestContext, label = "urls") {
  const name = testName(label);
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name },
  });
  return { id: (await res.json()).data.budget.id as string, name };
}

// Stands in for links that do not exist yet: account rows (EXF-481) and month arrows (EXF-493).
async function inAppPush(page: Page, path: string) {
  await page.evaluate((p) => {
    history.pushState(
      {
        usr: null,
        key: Math.random().toString(36).slice(2, 10),
        idx: (history.state?.idx ?? 0) + 1,
      },
      "",
      p,
    );
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }, path);
}
const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __m: number }).__m = 1;
  });
const marker = (page: Page) => page.evaluate(() => (window as unknown as { __m?: number }).__m);

test("C1 plan URL keeps /budget and shows the current month", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  await page.goto(`/${id}/budget`);
  // The source keeps /budget with no month and shows the current month (polish P2).
  await expect(page).toHaveURL(`/${id}/budget`);
  await expect(page).toHaveTitle(`Plan | ${name} | Budget`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(monthLabel(M));
  await expect(page.getByRole("link", { name: "Plan", exact: true })).toHaveClass(/active/);
});

test("C2 month URLs", async ({ page, request }) => {
  const { id } = await newPlan(request);
  await page.goto(`/${id}/budget/${M1}`);
  await expect(page).toHaveURL(`/${id}/budget/${M1}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(monthLabel(M1));
  for (const bad of ["abcdef", "202613", "2026"]) {
    await page.goto(`/${id}/budget/${bad}`);
    await expect(page).toHaveURL(`/${id}/budget/${M}`);
  }
});

test("C3 all accounts", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  await page.goto(`/${id}/accounts`);
  await expect(page).toHaveTitle(`All Accounts | ${name} | Budget`);
  await expect(page.getByRole("link", { name: "All Accounts" })).toHaveClass(/active/);
});

test("C4 unknown account is replaced with All Accounts", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  await page.goto(`/${id}/accounts/${NO_ACCOUNT}`);
  // Source, measured live: an unknown account id is silently replaced with /accounts (polish P1).
  await expect(page).toHaveURL(`/${id}/accounts`);
  await expect(page).toHaveTitle(`All Accounts | ${name} | Budget`);
  await expect(page.getByRole("link", { name: "All Accounts" })).toHaveClass(/active/);
});

test("C5 reflect and reports", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  await page.goto(`/${id}/reflect`);
  await expect(page).toHaveURL(`/${id}/reflect/spending-breakdown`);
  for (const [slug, title] of REPORTS) {
    await page.goto(`/${id}/reflect/${slug}`);
    await expect(page).toHaveURL(`/${id}/reflect/${slug}`);
    await expect(page).toHaveTitle(`${title} | ${name} | Budget`);
    await expect(page.getByRole("link", { name: "Reflect" })).toHaveClass(/active/);
  }
  for (const bad of ["foo", "constructor"]) {
    await page.goto(`/${id}/reflect/${bad}`);
    await expect(page).toHaveURL(`/${id}/budget`);
  }
});

test("C6 hard reload keeps the screen and title", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  const urls: [string, string][] = [
    [`/${id}/budget/${M}`, `Plan | ${name} | Budget`],
    [`/${id}/accounts`, `All Accounts | ${name} | Budget`],
    [`/${id}/reflect/net-worth`, `Net Worth Report | ${name} | Budget`],
  ];
  for (const [url, title] of urls) {
    await page.goto(url);
    await expect(page).toHaveTitle(title);
    await page.reload();
    await expect(page).toHaveURL(url);
    await expect(page).toHaveTitle(title);
  }
});

test("C7 unknown sub-paths land on the plan", async ({ page, request }) => {
  const { id } = await newPlan(request);
  for (const p of [`/${id}`, `/${id}/nonexistent`, `/${id}/budget/${M}/extra`]) {
    await page.goto(p);
    await expect(page).toHaveURL(`/${id}/budget`);
  }
});

test("C8 history sequence without reload", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  const side = page.getByRole("navigation", { name: "Sidebar" });
  await page.goto(`/${id}/budget/${M}`);
  await expect(side.getByRole("button", { name })).toBeVisible();
  await mark(page);
  await side.getByRole("link", { name: "All Accounts" }).click();
  await expect(page).toHaveURL(`/${id}/accounts`);
  // The push adds an entry, which the unknown-account redirect replaces with /accounts: two /accounts entries.
  await inAppPush(page, `/${id}/accounts/${NO_ACCOUNT}`);
  await expect(page).toHaveURL(`/${id}/accounts`);
  await side.getByRole("link", { name: "Reflect" }).click();
  await expect(page).toHaveURL(`/${id}/reflect/spending-breakdown`);
  await expect(page).toHaveTitle(`Spending Breakdown | ${name} | Budget`);
  await page.goBack();
  await expect(page).toHaveURL(`/${id}/accounts`);
  await expect(page).toHaveTitle(`All Accounts | ${name} | Budget`);
  await page.goBack(); // the replaced account entry
  await page.goBack();
  await expect(page).toHaveURL(`/${id}/budget/${M}`);
  await expect(page).toHaveTitle(`Plan | ${name} | Budget`);
  await page.goForward();
  await expect(page).toHaveURL(`/${id}/accounts`);
  await expect(page).toHaveTitle(`All Accounts | ${name} | Budget`);
  expect(await marker(page)).toBe(1);
});

test("C9 a month change pushes an entry", async ({ page, request }) => {
  const { id } = await newPlan(request);
  const side = page.getByRole("navigation", { name: "Sidebar" });
  await page.goto(`/${id}/budget/${M}`);
  await mark(page);
  await inAppPush(page, `/${id}/budget/${M1}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(monthLabel(M1));
  await page.goBack();
  await expect(page).toHaveURL(`/${id}/budget/${M}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(monthLabel(M));
  await page.goForward();
  await side.getByRole("link", { name: "All Accounts" }).click();
  await expect(page.getByRole("link", { name: "Plan", exact: true })).toHaveAttribute(
    "href",
    `/${id}/budget/${M1}`,
  );
  expect(await marker(page)).toBe(1);
});

test("C10 menus and dialogs leave the URL and history alone", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  const side = page.getByRole("navigation", { name: "Sidebar" });
  await page.goto(`/${id}/budget/${M}`);
  await expect(side.getByRole("button", { name })).toBeVisible();
  const before = await page.evaluate(() => [location.href, history.length]);
  await side.getByRole("button", { name }).click();
  await page.getByRole("menuitem", { name: /Open Plan/ }).click();
  await expect(page.getByRole("menu", { name: "Plans" })).toBeVisible();
  await page.keyboard.press("Escape");
  await side.getByRole("button", { name }).click();
  await page.getByRole("menuitem", { name: "New Plan" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Cancel|Close/ })
    .first()
    .click();
  await side.getByRole("button", { name: "Add Account" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.evaluate(() => [location.href, history.length])).toEqual(before);
});

test("C11 rename updates the title", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  await page.goto(`/${id}/budget/${M}`);
  await expect(page).toHaveTitle(`Plan | ${name} | Budget`);
  const res = await request.patch(`/api/v1/budgets/${id}`, {
    headers: await authHeaders(),
    data: { name: `${name} R` },
  });
  expect(res.ok()).toBe(true);
  await page.getByRole("link", { name: "All Accounts" }).click();
  await expect(page).toHaveTitle(`All Accounts | ${name} R | Budget`);
  await expect(
    page.getByRole("navigation", { name: "Sidebar" }).getByRole("button", { name: `${name} R` }),
  ).toBeVisible();
});

test("C12 unknown or deleted plan shows not found", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  await request.delete(`/api/v1/budgets/${id}`, { headers: await authHeaders() });
  for (const bad of [crypto.randomUUID(), id]) {
    await page.goto(`/${bad}/budget`);
    await expect(page.getByRole("heading", { name: "Plan not found" })).toBeVisible();
    await expect(page).toHaveURL(`/${bad}/budget`);
    await expect(page).toHaveTitle("Plan Not Found | Budget");
    await expect(page.getByRole("link", { name: "Go to your plans" })).toHaveAttribute("href", "/");
    await expect(
      page.getByRole("navigation", { name: "Sidebar" }).getByRole("button", { name }),
    ).toHaveCount(0);
  }
});

test("C13 root opens the last-opened plan", async ({ page, request }) => {
  const a = await newPlan(request, "A");
  const b = await newPlan(request, "B");
  const side = page.getByRole("navigation", { name: "Sidebar" });
  await page.goto(`/${a.id}/budget`);
  await expect(side.getByRole("button", { name: a.name })).toBeVisible();
  await page.goto(`/${b.id}/budget`);
  await expect(side.getByRole("button", { name: b.name })).toBeVisible();
  await page.goto(`/${a.id}/budget`);
  await expect(side.getByRole("button", { name: a.name })).toBeVisible();
  // Poll the API until both opens are recorded (they are fire-and-forget).
  await expect
    .poll(async () => {
      const list = (
        await (await request.get("/api/v1/budgets", { headers: await authHeaders() })).json()
      ).data.budgets;
      const get = (i: string) => list.find((x: { id: string }) => x.id === i)?.last_opened_at ?? "";
      return get(a.id) > get(b.id) && get(b.id) !== "";
    })
    .toBe(true);

  const resp = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/budgets") && r.request().method() === "GET",
  );
  await page.goto("/");
  const budgets = (await (await resp).json()).data.budgets as {
    id: string;
    last_opened_at: string | null;
  }[];
  const x = budgets.reduce((p, c) => ((c.last_opened_at ?? "") > (p.last_opened_at ?? "") ? c : p));
  await expect(page).toHaveURL(`/${x.id}/budget`);
  expect(budgets.find((p) => p.id === a.id)?.last_opened_at).not.toBeNull();

  await side.getByRole("button").first().click();
  await page.getByRole("menuitem", { name: /Open Plan/ }).click();
  await page.getByRole("menuitem", { name: b.name }).click();
  await expect(page).toHaveURL(`/${b.id}/budget`);
  await expect
    .poll(async () => {
      const list = (
        await (await request.get("/api/v1/budgets", { headers: await authHeaders() })).json()
      ).data.budgets;
      const get = (i: string) => list.find((y: { id: string }) => y.id === i)?.last_opened_at ?? "";
      return get(b.id) > get(a.id);
    })
    .toBe(true);
});
