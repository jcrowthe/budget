import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { mouseClick } from "./support/menu";
import { ownUser } from "./support/own-user";

// EXF-472 Display Options. One ZZ-TEST user per test (settings are per user), one seeded plan per test.

const user = await ownUser("display");
test.use({ storageState: user.storageState });

let planId = "";
let planName = "";
const userHeaders = (extra: Record<string, string> = {}) => ({
  "Cf-Access-Jwt-Assertion": user.token,
  ...extra,
});

test.beforeEach(async ({ request }: { request: APIRequestContext }) => {
  planName = testName("display");
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: planName },
  });
  planId = (await res.json()).data.budget.id;
  // A fresh user for every test: back to the defaults.
  await request.patch("/api/v1/settings", {
    headers: userHeaders(),
    data: { theme: "dark", progress_bars: true, balance_style: "default" },
  });
});
test.afterEach(async ({ request }: { request: APIRequestContext }) => {
  await request.delete(`/api/v1/budgets/${planId}`, { headers: await authHeaders() });
});

const css = (loc: Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const html = (page: Page) => page.locator("html");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Display Options" });
const group = (page: Page, name: string) => dialog(page).getByRole("radiogroup", { name });
const radio = (page: Page, section: string, name: string) =>
  group(page, section).getByRole("radio", { name, exact: true });
const card = (page: Page, section: string, name: string) =>
  group(page, section)
    .locator("label[data-active]")
    .filter({ has: page.getByRole("radio", { name, exact: true }) });

async function openPlan(page: Page) {
  await page.goto(`/${planId}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
}
async function openDialog(page: Page) {
  await mouseClick(
    page,
    page.getByRole("navigation", { name: "Sidebar" }).getByRole("button", {
      name: planName,
      exact: true,
    }),
  );
  await mouseClick(
    page,
    page.getByRole("menu", { name: "Plan", exact: true }).getByRole("menuitem", {
      name: "Display Options",
      exact: true,
    }),
  );
  await expect(dialog(page)).toBeVisible();
}
const apply = (page: Page) =>
  dialog(page).getByRole("button", { name: "Apply", exact: true }).click();
const cancel = (page: Page) =>
  dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
const saved = async (request: APIRequestContext) =>
  (await (await request.get("/api/v1/settings", { headers: userHeaders() })).json()).data;
const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [
    number,
    number,
    number,
  ];
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

test("AC1 the dialog shows three sections with the current values (Dark / On / Default)", async ({
  page,
}) => {
  await openPlan(page);
  await openDialog(page);
  const d = dialog(page);
  await expect(d.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(d.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(d.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  for (const h of ["Theme", "Progress Bars", "Balance Style"]) {
    await expect(d.getByRole("heading", { name: h, exact: true })).toBeVisible();
    await expect(group(page, h)).toBeVisible();
  }
  await expect(group(page, "Theme").getByRole("radio")).toHaveCount(3);
  for (const n of ["Default", "Dark", "Match System"]) {
    await expect(radio(page, "Theme", n)).toBeVisible();
  }
  for (const n of ["On", "Off"]) await expect(radio(page, "Progress Bars", n)).toBeVisible();
  for (const n of ["Default", "Differentiate Without Color"]) {
    await expect(radio(page, "Balance Style", n)).toBeVisible();
  }
  await expect(radio(page, "Theme", "Dark")).toBeChecked();
  await expect(radio(page, "Progress Bars", "On")).toBeChecked();
  await expect(radio(page, "Balance Style", "Default")).toBeChecked();
  await expect(card(page, "Theme", "Dark")).toHaveAttribute("data-active", "true");
  await expect(card(page, "Theme", "Default")).toHaveAttribute("data-active", "false");
  // the active card has the highlighted border (--actionPrimary)
  const active = await css(card(page, "Theme", "Dark"), "border-top-color");
  const idle = await css(card(page, "Theme", "Default"), "border-top-color");
  expect(active).toBe("rgb(117, 131, 255)");
  expect(idle).not.toBe(active);
  // each Balance Style card previews -$10.00, $10.00 and $10.00
  for (const n of ["Default", "Differentiate Without Color"]) {
    const pills = card(page, "Balance Style", n).locator(".available-pill");
    await expect(pills).toHaveCount(3);
    await expect(pills.nth(0)).toHaveText(/^[-−]\$10\.00$/);
    await expect(pills.nth(1)).toHaveText("$10.00");
    await expect(pills.nth(2)).toHaveText("$10.00");
  }
});

test("AC2 selecting Default previews light at once; Cancel, ✕ and Escape bring Dark back", async ({
  page,
}) => {
  await openPlan(page);
  await expect(html(page)).toHaveClass(/\btheme-dark\b/);
  await openDialog(page);
  await card(page, "Theme", "Default").click();
  await expect(html(page)).toHaveClass(/\btheme-light\b/);
  await expect(html(page)).not.toHaveClass(/\btheme-dark\b/);
  expect(luminance(await css(page.locator("body"), "background-color"))).toBeGreaterThan(0.5);
  await cancel(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect(html(page)).toHaveClass(/\btheme-dark\b/);
  expect(await css(page.locator("body"), "background-color")).toBe("rgb(12, 13, 34)");
  await openDialog(page);
  await expect(radio(page, "Theme", "Dark")).toBeChecked();
  for (const how of ["close", "escape"] as const) {
    await card(page, "Theme", "Default").click();
    await expect(html(page)).toHaveClass(/\btheme-light\b/);
    if (how === "close") await dialog(page).getByRole("button", { name: "Close" }).click();
    else await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(html(page)).toHaveClass(/\btheme-dark\b/);
    await openDialog(page);
    await expect(radio(page, "Theme", "Dark")).toBeChecked();
  }
});

test("AC3 Apply and Enter persist across a reload and on another browser", async ({
  page,
  browser,
  request,
}) => {
  await openPlan(page);
  await openDialog(page);
  await card(page, "Theme", "Default").click();
  await apply(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect(html(page)).toHaveClass(/\btheme-light\b/);
  await expect.poll(async () => (await saved(request)).theme).toBe("default");
  await page.reload();
  await expect(html(page)).toHaveClass(/\btheme-light\b/);
  await openDialog(page);
  await expect(radio(page, "Theme", "Default")).toBeChecked();
  // another browser: same user, empty localStorage
  const other = await (browser as Browser).newContext({ storageState: user.storageState });
  const p2 = await other.newPage();
  await p2.goto(`/${planId}/budget`);
  await expect(p2.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(p2.locator("html")).toHaveClass(/\btheme-light\b/);
  await other.close();
  // Dark and Enter
  await card(page, "Theme", "Dark").click();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toHaveCount(0);
  await expect(html(page)).toHaveClass(/\btheme-dark\b/);
  await expect.poll(async () => (await saved(request)).theme).toBe("dark");
  await page.reload();
  await expect(html(page)).toHaveClass(/\btheme-dark\b/);
});

test("AC3 first paint: the saved theme is on <html> before the settings request returns", async ({
  page,
  request,
}) => {
  await openPlan(page);
  await openDialog(page);
  await card(page, "Theme", "Default").click();
  await apply(page);
  await expect.poll(async () => (await saved(request)).theme).toBe("default");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("default");
  await page.route("**/api/v1/settings", (r) => r.abort());
  await page.goto(`/${planId}/budget`, { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => document.documentElement.className)).toMatch(/theme-light/);
});

test("AC4 the arrow keys cycle the theme cards", async ({ page }) => {
  await openPlan(page);
  await openDialog(page);
  const step = async (key: string, name: string, cls: RegExp) => {
    await page.keyboard.press(key);
    await expect(radio(page, "Theme", name)).toBeChecked();
    await expect(html(page)).toHaveClass(cls);
  };
  await step("ArrowRight", "Match System", /theme-(light|dark)/);
  await step("ArrowRight", "Default", /\btheme-light\b/);
  await step("ArrowLeft", "Match System", /theme-(light|dark)/);
  await step("ArrowLeft", "Dark", /\btheme-dark\b/);
});

test("AC5 Progress Bars Off removes the bars after Apply, and the toolbar stays in step", async ({
  page,
  request,
}) => {
  await openPlan(page);
  await expect(page.locator(".progress-bar").first()).toBeVisible();
  await openDialog(page);
  await card(page, "Progress Bars", "Off").click();
  await apply(page);
  await expect(page.locator(".progress-bar")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Progress Bars Off" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect.poll(async () => (await saved(request)).progress_bars).toBe(false);
  await page.reload();
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".progress-bar")).toHaveCount(0);
  // the reverse: the toolbar toggle is the same setting
  await page.getByRole("tab", { name: "Progress Bars On" }).click();
  await expect(page.locator(".progress-bar").first()).toBeVisible();
  await expect.poll(async () => (await saved(request)).progress_bars).toBe(true);
  await openDialog(page);
  await expect(radio(page, "Progress Bars", "On")).toBeChecked();
});

test("AC5 Cancel leaves the bars as they were", async ({ page }) => {
  await openPlan(page);
  await openDialog(page);
  await card(page, "Progress Bars", "Off").click();
  await expect(page.locator(".progress-bar")).toHaveCount(0);
  await cancel(page);
  await expect(page.locator(".progress-bar").first()).toBeVisible();
});

test("AC6 Match System follows the OS colour scheme", async ({ page, browser }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openPlan(page);
  await openDialog(page);
  await card(page, "Theme", "Match System").click();
  await apply(page);
  await expect(html(page)).toHaveClass(/\btheme-light\b/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).toHaveClass(/\btheme-dark\b/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).toHaveClass(/\btheme-light\b/);
  // a fresh browser whose OS is dark paints dark first
  const ctx = await (browser as Browser).newContext({
    storageState: user.storageState,
    colorScheme: "dark",
  });
  const p2 = await ctx.newPage();
  await p2.route("**/api/v1/settings", (r) => r.abort());
  await p2.goto(`/${planId}/budget`, { waitUntil: "domcontentloaded" });
  // nothing cached in this context yet, so this is the default: dark
  expect(await p2.evaluate(() => document.documentElement.className)).toMatch(/theme-dark/);
  await p2.unroute("**/api/v1/settings");
  await p2.goto(`/${planId}/budget`);
  await expect(p2.locator("html")).toHaveClass(/\btheme-dark\b/);
  await p2.evaluate(() => localStorage.setItem("theme", "match_system"));
  await p2.route("**/api/v1/settings", (r) => r.abort());
  await p2.goto(`/${planId}/budget`, { waitUntil: "domcontentloaded" });
  expect(await p2.evaluate(() => document.documentElement.className)).toMatch(/theme-dark/);
  await ctx.close();
});

test("Balance style: Differentiate Without Color tells the four pill states apart", async ({
  page,
  request,
}) => {
  const base = `/api/v1/budgets/${planId}`;
  const h = await authHeaders();
  const post = async (path: string, data: unknown) =>
    (await (await request.post(`${base}${path}`, { headers: h, data })).json()).data;
  await post("/accounts", { name: "ZZ-TEST Checking", type: "checking", balance: 500000 });
  const month = new Date();
  const iso = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;
  const cats = (
    await (await request.get(`${base}/months/${iso}`, { headers: h })).json()
  ).data.groups.flatMap((g: { categories: { id: string; name: string }[] }) => g.categories);
  const [pos, neg, caut] = cats as { id: string; name: string }[];
  const patchAssigned = (id: string, assigned: number) =>
    request.patch(`${base}/months/${iso}/categories/${id}`, { headers: h, data: { assigned } });
  await patchAssigned((pos as { id: string }).id, 50000);
  await patchAssigned((neg as { id: string }).id, 10000);
  await post("/transactions", {
    account_id: (await post("/accounts", { name: "ZZ-TEST Spend", type: "checking", balance: 0 }))
      .account.id,
    date: `${iso.slice(0, 8)}01`,
    amount: -30000,
    category_id: (neg as { id: string }).id,
  });
  const today = new Date().toISOString().slice(0, 10);
  await request.put(`${base}/categories/${(caut as { id: string }).id}/target?today=${today}`, {
    headers: h,
    data: { cadence: "monthly", behavior: "set_aside", amount: 100000 },
  });
  await request.patch("/api/v1/settings", {
    headers: userHeaders(),
    data: { balance_style: "differentiate_without_color" },
  });
  await openPlan(page);
  await expect(html(page)).toHaveClass(/balance-no-color/);
  const pill = (tone: string) => page.locator(`.category-row .available-pill.${tone}`).first();
  const probe = async (tone: string) => {
    const l = pill(tone);
    await expect(l).toBeVisible();
    return l.evaluate((el) => {
      const c = getComputedStyle(el);
      return {
        bg: c.backgroundColor,
        style: c.borderTopStyle,
        width: Number.parseFloat(c.borderTopWidth),
      };
    });
  };
  const neg4 = await probe("negative");
  const pos4 = await probe("positive");
  const cau4 = await probe("cautious");
  const zero4 = await probe("zero");
  expect(neg4.bg).toBe("rgba(0, 0, 0, 0)");
  expect(neg4.width).toBeGreaterThanOrEqual(2.5);
  expect(neg4.style).toBe("solid");
  expect(pos4.bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(cau4.style).toBe("dashed");
  expect(zero4.style).toBe("solid");
  expect(zero4.width).toBe(1);
  const keys = [neg4, pos4, cau4, zero4].map(
    (p) => `${p.bg !== "rgba(0, 0, 0, 0)"}|${p.style}|${p.width}`,
  );
  expect(new Set(keys).size).toBe(4);
});

test("Dark tokens unchanged: key values pinned from the main branch", async ({ page }) => {
  await openPlan(page);
  const token = (n: string) =>
    page.evaluate(
      (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
      n,
    );
  const pinned: Record<string, string> = {
    "--backgroundPrimary": "#0c0d22",
    "--backgroundSecondary": "#15172d",
    "--backgroundTertiary": "#1f2038",
    "--sidebarBackground": "#121330",
    "--labelPrimary": "#fff",
    "--labelSecondary": "#c4c5cf",
    "--actionPrimary": "#7583ff",
    "--statusPositive": "#77ba21",
    "--statusNegative": "#bf2e3b",
    "--labelNegative": "#ee5867",
    "--inputBackground": "#3c3e53",
    "--categoryBalanceWarningBackground": "#f6c91d",
    "--overlay": "#00000054",
    "--colorScheme": "dark",
  };
  for (const [name, value] of Object.entries(pinned)) expect(await token(name), name).toBe(value);
  expect(await css(page.locator("body"), "background-color")).toBe("rgb(12, 13, 34)");
  expect(await css(page.getByRole("navigation", { name: "Sidebar" }), "background-color")).toBe(
    "rgb(18, 19, 48)",
  );
  await openDialog(page);
  expect(await css(dialog(page), "background-color")).toBe("rgb(31, 32, 56)");
  await cancel(page);
  await mouseClick(
    page,
    page.getByRole("navigation", { name: "Sidebar" }).getByRole("button", {
      name: planName,
      exact: true,
    }),
  );
  expect(await css(page.getByRole("menu", { name: "Plan", exact: true }), "background-color")).toBe(
    "rgb(31, 32, 56)",
  );
  await page.keyboard.press("Escape");
  const pills: Record<string, [string, string]> = {
    zero: ["rgb(60, 62, 83)", "rgb(155, 156, 170)"],
    positive: ["rgb(119, 186, 33)", "rgb(12, 13, 34)"],
    cautious: ["rgb(246, 201, 29)", "rgb(12, 13, 34)"],
    negative: ["rgb(191, 46, 59)", "rgb(255, 255, 255)"],
  };
  for (const [tone, [bg, color]] of Object.entries(pills)) {
    const probe = await page.evaluate((t) => {
      const b = document.createElement("button");
      b.className = `available-pill ${t}`;
      b.textContent = "$1.00";
      document.querySelector(".category-row .cell-available")?.appendChild(b);
      const c = getComputedStyle(b);
      const out = [c.backgroundColor, c.color];
      b.remove();
      return out;
    }, tone);
    expect(probe, tone).toEqual([bg, color]);
  }
});

// ---- Light theme: contrast of rendered text (contract item 3), computed from the page's own colours ----
import { expectContrast, weakText } from "./support/contrast";
import { call as apiCall, seed as seedRegister, TODAY } from "./support/register-seed";

const goLight = async (request: APIRequestContext, balance_style = "default") => {
  const res = await request.patch("/api/v1/settings", {
    headers: userHeaders(),
    data: { theme: "default", balance_style },
  });
  expect(res.ok()).toBe(true);
};

/** One category for each pill tone: positive (assigned), negative (outflow > assigned), cautious (underfunded target), zero (untouched). */
async function seedTones(request: APIRequestContext) {
  const base = `/api/v1/budgets/${planId}`;
  const h = await authHeaders();
  const post = async (path: string, data: unknown) =>
    (await (await request.post(`${base}${path}`, { headers: h, data })).json()).data;
  const checking = (
    await post("/accounts", { name: "ZZ-TEST Checking", type: "checking", balance: 500000 })
  ).account.id;
  const iso = `${TODAY.slice(0, 7)}-01`;
  const months = (await (await request.get(`${base}/months/${iso}`, { headers: h })).json()).data;
  const cats = months.groups.flatMap((g: { categories: { id: string }[] }) => g.categories);
  const [pos, neg, caut] = cats as { id: string }[];
  const assign = (id: string, assigned: number) =>
    request.patch(`${base}/months/${iso}/categories/${id}`, { headers: h, data: { assigned } });
  await assign((pos as { id: string }).id, 50000);
  await assign((neg as { id: string }).id, 10000);
  await post("/transactions", {
    account_id: checking,
    date: TODAY,
    amount: -30000,
    category_id: (neg as { id: string }).id,
  });
  await request.put(
    `${base}/categories/${(caut as { id: string }).id}/target?today=${new Date().toISOString().slice(0, 10)}`,
    { headers: h, data: { cadence: "monthly", behavior: "set_aside", amount: 100000 } },
  );
}

for (const style of ["default", "differentiate_without_color"]) {
  test(`light contrast: the Plan, with Balance Style ${style}`, async ({ page, request }) => {
    await seedTones(request);
    await goLight(request, style);
    await openPlan(page);
    await expect(html(page)).toHaveClass(/\btheme-light\b/);
    for (const tone of ["positive", "negative", "cautious", "zero"]) {
      await expectContrast(page.locator(`.category-row .available-pill.${tone}`).first());
    }
    await expectContrast(page.locator(".group-name").first());
    await expectContrast(page.locator(".category-name").first());
    await expectContrast(page.locator(".category-row .cell-assigned").first());
    await expectContrast(page.locator(".category-row .amount").first());
    await expectContrast(page.getByRole("button", { name: "Recent Moves" }));
    await expectContrast(page.locator(".month-button").first());
    expect(await weakText(page)).toEqual([]);
  });
}

test("light contrast: a register", async ({ page, request }) => {
  const s = await seedRegister(request);
  await apiCall(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: TODAY,
    amount: -25000,
    category_id: s.category,
    payee_name: "ZZ-TEST Payee",
    memo: "ZZ-TEST memo",
  });
  await goLight(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(page.getByText("ZZ-TEST Payee").first()).toBeVisible();
  await expect(html(page)).toHaveClass(/\btheme-light\b/);
  await expectContrast(page.getByText("ZZ-TEST Payee").first());
  await expectContrast(page.getByText("ZZ-TEST memo").first());
  await expectContrast(page.locator(".acct-label").first());
  await expectContrast(page.locator(".acct-amount").first());
  await expectContrast(page.getByRole("columnheader").first());
  expect(await weakText(page)).toEqual([]);
  await request.delete(`/api/v1/budgets/${s.plan}`, { headers: await authHeaders() });
});

test("light contrast: the Display Options and Plan Settings dialogs", async ({ page, request }) => {
  await goLight(request);
  await openPlan(page);
  await openDialog(page);
  const d = dialog(page);
  await expectContrast(d.getByRole("heading", { name: "Display Options" }));
  for (const h of ["Theme", "Progress Bars", "Balance Style"]) {
    await expectContrast(d.getByRole("heading", { name: h, exact: true }));
  }
  await expectContrast(d.locator(".do-label").first());
  await expectContrast(d.getByRole("button", { name: "Cancel", exact: true }));
  await expectContrast(d.getByRole("button", { name: "Apply", exact: true }));
  expect(await weakText(page, d)).toEqual([]);
  await cancel(page);
  await mouseClick(
    page,
    page.getByRole("navigation", { name: "Sidebar" }).getByRole("button", {
      name: planName,
      exact: true,
    }),
  );
  await mouseClick(
    page,
    page.getByRole("menu", { name: "Plan", exact: true }).getByRole("menuitem", {
      name: "Plan Settings",
      exact: true,
    }),
  );
  const ps = page.getByRole("dialog", { name: "Plan Settings" });
  await expect(ps).toBeVisible();
  await expectContrast(ps.getByRole("heading", { name: "Plan Settings" }));
  await expectContrast(ps.getByRole("button", { name: "Cancel" }));
  await expectContrast(ps.getByRole("button", { name: "Apply Settings" }));
  expect(await weakText(page, ps)).toEqual([]);
});
