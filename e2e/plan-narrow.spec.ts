import type { APIRequestContext, Locator, Page } from "@playwright/test";
import {
  autoCard,
  fixedClock,
  option,
  panel,
  removePlan,
  row,
  TODAY,
} from "./auto-assign.fixtures";
import { expect, test } from "./fixtures";
import { box } from "./plan-panel.fixtures";
import { authHeaders, testName } from "./support/auth";
import { monthIso } from "./support/plan-seed";
import { realClick } from "./support/real-click";

// EXF-622, EXF-623, EXF-646: the Plan page at 1024x700 with the sidebar at its default width, and with it dragged
// to 600px. Every measure is the browser's own (scrollWidth/clientWidth, boxes, a Range over the first word).
// The plan and every row are made through the API; clicks use a real mouse.

test.use({ timezoneId: "UTC", viewport: { width: 1024, height: 700 } });
const { at, today } = fixedClock();
const PREV = monthIso(-1);
const RENT = "Rent/Mortgage";
const PHONE = "Groceries";
const MISC = "Fun Money";
const DINING = "Dining Out";
const VISA = "Visa Rewards";
const CARD = "Store Card";

type Seed = { id: string; cat: Record<string, string> };

async function call(
  request: APIRequestContext,
  method: "post" | "patch" | "put",
  path: string,
  data: unknown,
) {
  const res = await request[method](path, { headers: await authHeaders(), data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json()).data;
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const { budget } = await call(request, "post", "/api/v1/budgets", { name: testName("narrow") });
  const base = `/api/v1/budgets/${budget.id}`;
  const open = async (name: string, type: string, balance: number, date: string) =>
    (await call(request, "post", `${base}/accounts`, { name, type, balance, date })).account
      .id as string;
  await open("ZZ Checking", "checking", 5000000, `${TODAY.slice(0, 8)}01`);
  const visa = await open(VISA, "creditCard", 0, `${TODAY.slice(0, 8)}02`);
  // Owes 2,560.00 since last month, with 1,200.00 assigned to its payment last month: Underfunded 1,360.00.
  await open(CARD, "creditCard", 2560000, `${PREV.slice(0, 8)}02`);
  const { category_group: g } = await call(request, "post", `${base}/category_groups`, {
    name: "Monthly Bills",
  });
  const cat: Record<string, string> = {};
  for (const name of [RENT, PHONE, MISC, DINING]) {
    cat[name] = (
      await call(request, "post", `${base}/categories`, { group_id: g.id, name })
    ).category.id;
  }
  const target = (name: string, body: unknown) =>
    call(request, "put", `${base}/categories/${cat[name]}/target?today=${today}`, body);
  await target(RENT, { cadence: "monthly", behavior: "set_aside", amount: 1200000 });
  await target(PHONE, { cadence: "monthly", behavior: "refill", amount: 160000 });
  await call(request, "patch", `${base}/months/${PREV}/categories/${cat[MISC]}`, {
    assigned: 1200000,
  });
  // The card's payment category is named like the account.
  const month = await call(request, "post", `${base}/transactions`, {
    account_id: visa,
    date: `${TODAY.slice(0, 8)}10`,
    amount: -1200000,
    category_id: cat[DINING],
  }).then(() => request.get(`${base}/months/${TODAY}?today=${today}`, { headers: authHeaders() }));
  void month;
  const read = (
    await (
      await request.get(`${base}/months/${TODAY}?today=${today}`, {
        headers: await authHeaders(),
      })
    ).json()
  ).data;
  for (const c of read.groups.flatMap(
    (x: { categories: { id: string; name: string }[] }) => x.categories,
  )) {
    cat[c.name] = c.id;
  }
  await call(request, "patch", `${base}/months/${PREV}/categories/${cat[CARD]}`, {
    assigned: 1200000,
  });
  return { id: budget.id, cat };
}

let s: Seed;
test.beforeEach(async ({ request, page }) => {
  await page.clock.setFixedTime(at);
  s = await seed(request);
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s as never);
});

const open = async (page: Page) => {
  await page.goto(`/${s.id}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(row(page, RENT)).toBeVisible();
};
const tick = async (page: Page, name: string) => {
  await realClick(page, box(page, name));
  await expect(panel(page).getByRole("heading", { name, exact: true })).toBeVisible();
};

/** Every option button of a card: 32px, label whole, amount inside, no overlap with the next. */
async function optionsFit(scope: Locator) {
  const rows = await scope.locator("button.auto-assign-option").evaluateAll((els) =>
    els.map((b) => {
      const r = b.getBoundingClientRect();
      const label = b.querySelector("span") as HTMLElement;
      const amount = b.querySelector("strong") as HTMLElement;
      const a = amount.getBoundingClientRect();
      const pad = Number.parseFloat(getComputedStyle(b).paddingRight);
      return {
        text: b.textContent,
        h: r.height,
        top: r.top,
        bottom: r.bottom,
        tall: (b as HTMLElement).scrollHeight - (b as HTMLElement).clientHeight,
        label: label.scrollWidth - label.clientWidth,
        amountRight: r.right - pad - a.right,
        amountLeft: a.left - label.getBoundingClientRect().right,
      };
    }),
  );
  expect(rows.length).toBeGreaterThan(3);
  rows.forEach((r, i) => {
    expect(r.h, `${r.text} height`).toBeCloseTo(32, 0);
    expect(r.tall, `${r.text} scrollHeight`).toBeLessThanOrEqual(0);
    expect(r.label, `${r.text} label`).toBeLessThanOrEqual(1);
    expect(r.amountRight, `${r.text} amount inside`).toBeGreaterThanOrEqual(-0.5);
    expect(r.amountLeft, `${r.text} amount after label`).toBeGreaterThanOrEqual(-0.5);
    const next = rows[i + 1];
    if (next)
      expect(next.top, `${r.text} overlaps the next`).toBeGreaterThanOrEqual(r.bottom - 0.5);
  });
}

/** Every element with its own text inside the panel's cards has its box inside the card. */
async function textInsideCards(page: Page) {
  const bad = await panel(page).evaluate((aside) => {
    const out: string[] = [];
    for (const card of aside.querySelectorAll(".panel-card")) {
      const c = card.getBoundingClientRect();
      for (const el of card.querySelectorAll<HTMLElement>("*")) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
        if (!own || getComputedStyle(el).display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < c.left - 0.5 || r.right > c.right + 0.5)
          out.push(`${el.textContent}: outside`);
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible") {
          out.push(`${el.textContent}: cut`);
        }
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
}

/**
 * Where the name's first word (after a leading emoji, as a default category's name has one) ends, and where the
 * name's content box ends: the word is whole when its right edge is inside the box.
 */
const firstWordFit = (name: Locator) =>
  name.evaluate((el) => {
    const text = el.firstChild as Text;
    const full = text.textContent ?? "";
    const lead = full.match(/^\p{Extended_Pictographic}\uFE0F?\s*/u)?.[0].length ?? 0;
    const word = full.slice(lead).split(" ")[0] ?? "";
    const range = document.createRange();
    range.setStart(text, lead);
    range.setEnd(text, lead + word.length);
    const cs = getComputedStyle(el);
    return {
      name: full,
      right: range.getBoundingClientRect().right,
      limit: el.getBoundingClientRect().left + el.clientWidth - Number.parseFloat(cs.paddingRight),
    };
  });

test("19. the Auto-Assign options fit at 1024 in the card, an ordinary and a payment inspector", async ({
  page,
}) => {
  await open(page);
  await expect(option(autoCard(page), "Underfunded").locator("strong")).toHaveText("$1,360.00");
  // The plan-wide figure adds the card's payment category (1,200.00) to ZZ Misc's 1,200.00.
  await expect(option(autoCard(page), "Assigned Last Month").locator("strong")).toHaveText(
    "$2,400.00",
  );
  await optionsFit(autoCard(page));
  await page.screenshot({ path: ".screenshots/narrow-plan-wide-card.png" });
  await tick(page, RENT);
  await optionsFit(autoCard(page));
  await page.screenshot({ path: ".screenshots/narrow-ordinary-inspector.png" });
  await realClick(page, box(page, RENT));
  await tick(page, CARD);
  await expect(option(autoCard(page), "Underfunded").locator("strong")).toHaveText("$1,360.00");
  await expect(option(autoCard(page), "Assigned Last Month").locator("strong")).toHaveText(
    "$1,200.00",
  );
  await optionsFit(autoCard(page));
  await page.screenshot({ path: ".screenshots/narrow-payment-inspector.png" });
});

test("20. the panel is 320px and its cards hold their text", async ({ page }) => {
  await open(page);
  await tick(page, DINING);
  const w = (await panel(page).boundingBox())?.width ?? 0;
  expect(Math.abs(w - 320)).toBeLessThanOrEqual(1);
  const head = panel(page).locator(".card-roll-up", { hasText: "Available Balance" });
  const hb = await head.boundingBox();
  expect(hb?.height ?? 99).toBeLessThanOrEqual(56);
  const title = await head.locator(".panel-card-title").boundingBox();
  const pill = await head.locator(".available-pill").boundingBox();
  expect(pill?.y ?? 0).toBeGreaterThanOrEqual((title?.y ?? 0) - 1);
  expect(pill?.y ?? 99).toBeLessThanOrEqual((title?.y ?? 0) + (title?.height ?? 0));
  await textInsideCards(page);
  await realClick(page, box(page, DINING));
  await tick(page, VISA);
  await expect(panel(page).locator("section.payment-card")).toContainText(
    "in overspent categories",
  );
  expect(Math.abs(((await panel(page).boundingBox())?.width ?? 0) - 320)).toBeLessThanOrEqual(1);
  await textInsideCards(page);
});

test("21. a name keeps its first word, the target text gives way, the pill stays whole", async ({
  page,
}) => {
  await open(page);
  await page.screenshot({ path: ".screenshots/narrow-rows.png" });
  const grid = page.locator(".plan-grid");
  // Every category row of the plan, with and without target text: at least the first word of the name is whole
  // (a Range over it fits the name's content box), no amount is cut and the pill is whole.
  const rows = page.locator(".category-row:not(.uncategorized-row)");
  const count = await rows.count();
  expect(count).toBeGreaterThan(8);
  let withTarget = 0;
  for (let i = 0; i < count; i++) {
    const r = rows.nth(i);
    const n = r.locator(".category-name");
    const m = await firstWordFit(n);
    expect(
      m.right,
      `${m.name}: first word ends at ${m.right}px, the name's content box at ${m.limit}px`,
    ).toBeLessThanOrEqual(m.limit + 0.5);
    const label = r.locator(".status-label");
    if ((await label.count()) > 0) {
      withTarget++;
      const [nb, lb] = await Promise.all([n.boundingBox(), label.boundingBox()]);
      // Beside the name, or wrapped to the (clipped) second line under it (polish P3): never over it.
      const beside = (lb?.x ?? 0) + 0.5 >= (nb?.x ?? 0) + (nb?.width ?? 0);
      const below = (lb?.y ?? 0) + 0.5 >= (nb?.y ?? 0) + (nb?.height ?? 0);
      expect(beside || below, `${m.name}: label over the name`).toBe(true);
      await expect(label).toHaveAttribute("title", /.+/);
    }
    for (const sel of [".available-pill", ".assigned-box", ".cell-activity"]) {
      expect(
        await r
          .locator(sel)
          .first()
          .evaluate((el) => el.scrollWidth - el.clientWidth),
        `${m.name} ${sel}`,
      ).toBeLessThanOrEqual(0);
    }
  }
  expect(withTarget, "rows with target text").toBeGreaterThanOrEqual(2);
  // Group rows (the "Credit Card Payments" group too): the first word of the name is whole.
  const groups = page.locator(".group-row .group-name");
  for (let i = 0; i < (await groups.count()); i++) {
    const m = await firstWordFit(groups.nth(i));
    expect(
      m.right,
      `group ${m.name}: first word ends at ${m.right}px, box at ${m.limit}px`,
    ).toBeLessThanOrEqual(m.limit + 0.5);
  }
  // The group rows: the payment group's PAYMENT button and totals are whole.
  const pay = page.locator(".group-row", { hasText: "PAYMENT" }).locator(".cell-available");
  expect(await pay.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await grid.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test("21b. at 1440 both names and their status text show in full", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  for (const name of [RENT, PHONE]) {
    const r = row(page, name);
    for (const sel of [".category-name", ".status-label"]) {
      expect(
        await r.locator(sel).evaluate((el) => el.scrollWidth - el.clientWidth),
        `${name} ${sel}`,
      ).toBeLessThanOrEqual(0);
    }
  }
});

test("21c. with a 15px scrollbar a name that does not fit ellipsizes, nothing overlaps", async ({
  page,
}) => {
  await open(page);
  const grid = page.locator(".plan-grid");
  const before = await grid.evaluate((el) => el.clientWidth);
  // Headless Chromium hides scrollbars: take 15px as a headed browser's classic scrollbar does.
  await page.addStyleTag({
    content: ".plan-grid { box-sizing: border-box; border-right: 15px solid transparent }",
  });
  await expect.poll(() => grid.evaluate((el) => el.clientWidth)).toBe(before - 15);
  await page.screenshot({ path: ".screenshots/narrow-rows-scrollbar.png" });
  const rows = page.locator(".category-row:not(.uncategorized-row), .group-row");
  const count = await rows.count();
  expect(count).toBeGreaterThan(8);
  for (let i = 0; i < count; i++) {
    const r = rows.nth(i);
    const n = r.locator(".category-name, .group-name").first();
    const info = await n.evaluate((el) => {
      const cell = el.closest(".cell-name") ?? el.parentElement;
      const nb = el.getBoundingClientRect();
      const cb = (cell as HTMLElement).getBoundingClientRect();
      return {
        text: el.textContent ?? "",
        inside: nb.left >= cb.left - 0.5 && nb.right <= cb.right + 0.5,
        cut: el.scrollWidth > el.clientWidth,
        ellipsis: getComputedStyle(el).textOverflow === "ellipsis",
      };
    });
    expect(info.inside, `${info.text}: name outside its cell`).toBe(true);
    if (info.cut) expect(info.ellipsis, `${info.text}: cut without an ellipsis`).toBe(true);
    const label = r.locator(".status-label");
    if ((await label.count()) > 0) {
      const [nb, lb] = await Promise.all([n.boundingBox(), label.boundingBox()]);
      const beside = (lb?.x ?? 0) + 0.5 >= (nb?.x ?? 0) + (nb?.width ?? 0);
      const below = (lb?.y ?? 0) + 0.5 >= (nb?.y ?? 0) + (nb?.height ?? 0);
      expect(beside || below, `${info.text}: label over the name`).toBe(true);
    }
    for (const sel of [".available-pill", ".assigned-box", ".cell-activity"]) {
      const el = r.locator(sel).first();
      if ((await el.count()) === 0) continue;
      expect(
        await el.evaluate((e) => e.scrollWidth - e.clientWidth),
        `${info.text} ${sel}`,
      ).toBeLessThanOrEqual(0);
    }
  }
  expect(await grid.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test("22. with the sidebar at 600px the panel folds away and the grid scrolls inside itself", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("sidebar-preferred-width", "600"));
  await open(page);
  const body = await page.locator(".plan-body").boundingBox();
  expect(Math.abs((body?.width ?? 0) - 424)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  const grid = page.locator(".plan-grid");
  expect(await grid.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: ".screenshots/narrow-sidebar-600.png" });
  await grid.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  const p = await row(page, RENT).locator(".available-pill").boundingBox();
  const g = await grid.boundingBox();
  expect(p?.x ?? 0).toBeGreaterThanOrEqual(g?.x ?? 0);
  expect((p?.x ?? 0) + (p?.width ?? 0)).toBeLessThanOrEqual((g?.x ?? 0) + (g?.width ?? 0) + 0.5);
  await realClick(page, box(page, RENT));
  await expect(box(page, RENT)).toHaveAttribute("aria-checked", "true");
  // Collapsing the sidebar gives the panel its room back.
  await page
    .getByRole("navigation", { name: "Sidebar" })
    .getByRole("button", { name: "Expand/Collapse Sidebar" })
    .click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
});
