import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { box, panel, removePlan, row } from "./plan-panel.fixtures";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";

// EXF-535 (pills, inspector messages, chip) and EXF-532 (the Credit Card Payments group is not editable).
// The clock is fixed in November 2026; the plan and every row are made through the API.

const MONTH = "2026-11-01";
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
] as const;
const VISA = "ZZ-TEST Visa";
const CREDIT = "ZZ Credit";
const CASH = "ZZ Cash";
const MIXED = "ZZ Mixed";

type Seed = { id: string; cat: Record<string, string> };

async function call(
  request: APIRequestContext,
  method: "post" | "patch",
  path: string,
  data: unknown,
) {
  const res = await request[method](path, { headers: await authHeaders(), data });
  expect(res.ok(), `${method} ${path}`).toBe(true);
  return (await res.json()).data;
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const { budget } = await call(request, "post", "/api/v1/budgets", { name: testName("credit") });
  const base = `/api/v1/budgets/${budget.id}`;
  const open = async (name: string, type: string, balance: number) =>
    (await call(request, "post", `${base}/accounts`, { name, type, balance, date: "2026-11-02" }))
      .account.id;
  const checking = await open("ZZ-TEST Checking", "checking", 100000);
  const visa = await open(VISA, "creditCard", 0);
  const { category_group: g } = await call(request, "post", `${base}/category_groups`, {
    name: "ZZ Group",
  });
  const cat: Record<string, string> = {};
  for (const name of [CREDIT, CASH, MIXED]) {
    cat[name] = (
      await call(request, "post", `${base}/categories`, { group_id: g.id, name })
    ).category.id;
  }
  await call(request, "patch", `${base}/months/${MONTH}/categories/${cat[CREDIT]}`, {
    assigned: 50000,
  });
  const tx = (account: string, amount: number, category: string) =>
    call(request, "post", `${base}/transactions`, {
      account_id: account,
      date: "2026-11-10",
      amount,
      category_id: cat[category],
    });
  await tx(visa, -80000, CREDIT);
  await tx(checking, -25000, CASH);
  await tx(checking, -25000, MIXED);
  await tx(visa, -40000, MIXED);
  return { id: budget.id, cat };
}

const open = async (page: Page, s: Seed) => {
  await page.goto(`/${s.id}/budget/202611`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".category-row").first()).toBeVisible();
};
const pill = (page: Page, name: string) => row(page, name).locator(".available-pill");

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    let s: Seed;
    test.beforeEach(async ({ request, page }) => {
      await page.setViewportSize(size);
      await page.clock.setFixedTime(new Date("2026-11-16T12:00:00"));
      s = await seed(request);
    });
    test.afterEach(async ({ request }) => {
      await removePlan(request, { id: s.id } as never);
    });

    test("EXF-535: yellow credit pill, red cash and mixed pills, the chip", async ({ page }) => {
      await open(page, s);
      const credit = pill(page, CREDIT);
      await expect(credit).toHaveClass(/cautious/);
      await expect(credit).toHaveClass(/credit/);
      await expect(credit.locator('svg[data-icon="card"]')).toHaveCount(1);
      await expect(credit).toHaveText("−$30.00");
      for (const n of [CASH, MIXED]) {
        await expect(pill(page, n)).toHaveClass(/negative/);
        await expect(pill(page, n).locator("svg")).toHaveCount(0);
      }
      await expect(pill(page, CASH)).toHaveText("−$25.00");
      await expect(pill(page, MIXED)).toHaveText("−$65.00");
      await expect(
        page.locator(".view-chips").getByRole("button", { name: "3 Overspent", exact: true }),
      ).toBeVisible();
    });

    test("EXF-535: the three inspector messages and the spending lines", async ({ page }) => {
      await open(page, s);
      const msg = panel(page).locator(".inspector-message");
      await realClick(page, box(page, CREDIT));
      await expect(msg).toHaveText(
        "You've overspent this category by $30.00 with credit. Cover this overspending to avoid creating debt!",
      );
      await expect(msg).toHaveClass(/cautious/);
      await realClick(page, box(page, CREDIT));
      await realClick(page, box(page, CASH));
      await expect(msg).toHaveText(
        "You've overspent this category by $25.00. Cover this overspending or you can’t trust your plan balances!",
      );
      await expect(msg).toHaveClass(/negative/);
      await realClick(page, box(page, CASH));
      await realClick(page, box(page, MIXED));
      await expect(msg).toHaveText(
        "You've overspent this category by $65.00 with cash and credit. Add at least $25.00 to this category or you can’t trust your plan balances!",
      );
      const line = (label: string) =>
        panel(page)
          .locator(".panel-row", { has: page.getByText(label, { exact: true }) })
          .locator(".panel-row-value");
      await expect(line("Cash Spending")).toHaveText("−$25.00");
      await expect(line("Credit Spending")).toHaveText("−$40.00");
    });

    test("EXF-532: the Credit Card Payments group and its rows cannot be edited", async ({
      page,
    }) => {
      await open(page, s);
      const first = page.locator(".group-row").first();
      await expect(first).toContainText("Credit Card Payments");
      await expect(first.getByRole("button", { name: "Add Category", exact: true })).toHaveCount(0);
      await realClick(page, first.locator(".group-name"));
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(row(page, VISA)).toBeVisible();
      await realClick(page, box(page, VISA));
      await realClick(page, row(page, VISA).locator(".category-name"));
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: `Edit category: ${VISA}`, exact: true }),
      ).toHaveCount(0);
      await expect(panel(page).getByRole("heading", { name: VISA, exact: true })).toBeVisible();
      await expect(panel(page).locator("#panel-target")).toHaveCount(0);
    });
  });
}

// T14.4: the largest amounts of the tickets' examples (1,200.00 from C, 777.77 from B) at 1024×700.
test.describe("1024x700 fit", () => {
  const WIDE = { credit: "ZZ Wide Credit", cash: "ZZ Wide Cash", mixed: "ZZ Wide Mixed" };
  let planId = "";
  test.beforeEach(async ({ request, page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.clock.setFixedTime(new Date("2026-11-16T12:00:00"));
    const { budget } = await call(request, "post", "/api/v1/budgets", {
      name: testName("credit-wide"),
    });
    planId = budget.id;
    const base = `/api/v1/budgets/${planId}`;
    const open = async (name: string, type: string, balance: number) =>
      (await call(request, "post", `${base}/accounts`, { name, type, balance, date: "2026-11-02" }))
        .account.id;
    const checking = await open("ZZ-TEST Checking", "checking", 5000000);
    const visa = await open(VISA, "creditCard", 0);
    const { category_group: g } = await call(request, "post", `${base}/category_groups`, {
      name: "ZZ Group",
    });
    const cat: Record<string, string> = {};
    for (const name of Object.values(WIDE)) {
      cat[name] = (
        await call(request, "post", `${base}/categories`, { group_id: g.id, name })
      ).category.id;
    }
    const tx = (account: string, amount: number, category: string) =>
      call(request, "post", `${base}/transactions`, {
        account_id: account,
        date: "2026-11-10",
        amount,
        category_id: cat[category],
      });
    await tx(visa, -1200000, WIDE.credit);
    await tx(checking, -1200000, WIDE.cash);
    await tx(checking, -777770, WIDE.mixed);
    await tx(visa, -1200000, WIDE.mixed);
  });
  test.afterEach(async ({ request }) => {
    await removePlan(request, { id: planId } as never);
  });

  test("EXF-535: at 1024×700 the pills, messages and spending lines fit", async ({ page }) => {
    await open(page, { id: planId, cat: {} });
    const TOL = 0.5;
    type R = { l: number; r: number; t: number; b: number };
    const rect = (loc: ReturnType<typeof pill>): Promise<R> =>
      loc.evaluate((e) => {
        const x = e.getBoundingClientRect();
        return { l: x.left, r: x.right, t: x.top, b: x.bottom };
      });
    const noOverflow = async (loc: ReturnType<typeof pill>, what: string) => {
      const m = await loc.evaluate((e) => ({ s: e.scrollWidth, c: e.clientWidth }));
      expect(m.s, `${what}: scrollWidth ${m.s} vs clientWidth ${m.c}`).toBeLessThanOrEqual(
        m.c + TOL,
      );
    };
    const inside = (a: R, o: R, what: string) => {
      expect(a.l, `${what}: left ${a.l} vs ${o.l}`).toBeGreaterThanOrEqual(o.l - TOL);
      expect(a.r, `${what}: right ${a.r} vs ${o.r}`).toBeLessThanOrEqual(o.r + TOL);
    };

    const texts: [string, string][] = [
      [WIDE.credit, "−$1,200.00"],
      [WIDE.cash, "−$1,200.00"],
      [WIDE.mixed, "−$1,977.77"],
    ];
    for (const [name, text] of texts) {
      const p = pill(page, name);
      await expect(p).toHaveText(text);
      // The source clips a pill wider than its column (84.3px at 1024, probed live): no scrollWidth check on
      // pills, but the text stays on one line.
      const lineH = await p.evaluate((e) => ({
        h: e.getBoundingClientRect().height,
        lh: Number.parseFloat(getComputedStyle(e).lineHeight),
      }));
      expect(lineH.h, `pill ${name} height ${lineH.h} (one line)`).toBeLessThan(lineH.lh * 2);
      const cell = p.locator("xpath=..");
      const pr = await rect(p);
      inside(pr, await rect(cell), `pill ${name} in its cell`);
      const prev = cell.locator("xpath=preceding-sibling::*[1]");
      if ((await prev.count()) > 0) {
        const ar = await rect(prev);
        expect(pr.l, `pill ${name} overlaps the Activity cell`).toBeGreaterThanOrEqual(ar.r - TOL);
      }
    }
    const icon = pill(page, WIDE.credit).locator('svg[data-icon="card"]');
    inside(await rect(icon), await rect(pill(page, WIDE.credit)), "icon in the yellow pill");

    const msg = panel(page).locator(".inspector-message");
    const messages: [string, RegExp][] = [
      [WIDE.credit, /by \$1,200\.00 with credit\./],
      [WIDE.cash, /by \$1,200\.00\. Cover this overspending/],
      [WIDE.mixed, /by \$1,977\.77 with cash and credit\. Add at least \$777\.77 to this category/],
    ];
    for (const [name, re] of messages) {
      await realClick(page, box(page, name));
      await expect(msg).toHaveText(re);
      await noOverflow(msg, `message ${name}`);
      const headCard = panel(page).locator(".panel-card", { has: page.locator("#panel-balance") });
      const head = headCard.locator(".card-roll-up-right .available-pill");
      inside(await rect(head), await rect(headCard), `inspector header pill ${name} in its card`);
      inside(await rect(msg), await rect(msg.locator("xpath=..")), `message ${name} in its card`);
      if (name === WIDE.mixed) {
        const line = (label: string) =>
          panel(page).locator(".panel-row", { has: page.getByText(label, { exact: true }) });
        const cash = line("Cash Spending");
        const credit = line("Credit Spending");
        await expect(cash.locator(".panel-row-value")).toHaveText("−$777.77");
        await expect(credit.locator(".panel-row-value")).toHaveText("−$1,200.00");
        for (const l of [cash, credit]) {
          const label = l.locator(".panel-row-label");
          const value = l.locator(".panel-row-value");
          await noOverflow(label, "spending label");
          await noOverflow(value, "spending value");
          const lr = await rect(label);
          const vr = await rect(value);
          expect(lr.r, `label right ${lr.r} vs value left ${vr.l}`).toBeLessThanOrEqual(vr.l + TOL);
          const card = await rect(l.locator("xpath=ancestor::section[1]"));
          inside(lr, card, "label in its card");
          inside(vr, card, "value in its card");
        }
      }
      await realClick(page, box(page, name));
    }
  });
});
