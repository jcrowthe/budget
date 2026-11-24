import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { patchPlan } from "./support/plan-formats-seed";
import { call, MONTH, TODAY } from "./support/register-seed";

// EXF-726 (with EXF-468): at 1024x700 the number columns of the Plan grid hold amounts of up to twelve
// characters, made of wide digits, whole on one line; a longer one never wraps and is cut only with an ellipsis
// and a title. Every number is the browser's own measurement.

test.use({ viewport: { width: 1024, height: 700 } });

const CATS = [
  // name, assigned, outflow (Activity). Availables follow: 88,000,000 / -89,777,760 / -888,888,880 / 888,888,880.
  { name: "Wide Alpha Groceries", assigned: 88888880, spent: 888880 },
  { name: "Wide Bravo Utilities", assigned: -888880, spent: 88888880 },
  { name: "Wide Charlie Holidays", assigned: 0, spent: 888888880 },
  { name: "Wide Delta Savings", assigned: 888888880, spent: 0 },
];

async function seedWide(request: APIRequestContext, extra: { name: string; spent: number }[] = []) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("wide") });
  const plan = budget.id as string;
  const account = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ Wide",
      type: "checking",
      balance: 0,
      date: TODAY,
    })
  ).account.id as string;
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, {
      name: "ZZ Wide Group",
    })
  ).category_group.id as string;
  for (const c of [...CATS, ...extra.map((e) => ({ ...e, assigned: 0 }))]) {
    const id = (
      await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
        group_id: group,
        name: c.name,
      })
    ).category.id as string;
    if (c.assigned !== 0) {
      await call(request, "PATCH", `/api/v1/budgets/${plan}/months/${MONTH}/categories/${id}`, {
        assigned: c.assigned,
      });
    }
    if (c.spent > 0) {
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: account,
        date: TODAY,
        amount: -c.spent,
        category_id: id,
        payee_name: "ZZ Payee",
      });
    }
  }
  return plan;
}

type Measure = {
  what: string;
  text: string;
  scrollWidth: number;
  clientWidth: number;
  lines: number;
  right: number;
  boxRight: number;
  ellipsis: boolean;
  cellRight: number;
  title: string;
};

/** Measures every amount of the wide rows: scrollWidth against clientWidth, lines of text, the right edge. */
async function measure(page: Page): Promise<Measure[]> {
  return page.evaluate(() => {
    const out: Measure[] = [];
    const lines = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
    };
    const textRight = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return Math.max(...[...r.getClientRects()].map((x) => x.right));
    };
    const add = (what: string, box: HTMLElement, textEl: Element, cell: Element) => {
      out.push({
        what,
        text: (textEl.textContent ?? "").trim(),
        // A block-level text element (the pill's amount) clips itself; the others are clipped by their box.
        scrollWidth:
          (textEl as HTMLElement).clientWidth > 0
            ? (textEl as HTMLElement).scrollWidth
            : box.scrollWidth,
        clientWidth:
          (textEl as HTMLElement).clientWidth > 0
            ? (textEl as HTMLElement).clientWidth
            : box.clientWidth,
        lines: lines(textEl),
        right: textRight(textEl),
        boxRight: box.getBoundingClientRect().right,
        ellipsis:
          getComputedStyle((textEl as HTMLElement).clientWidth > 0 ? textEl : box).textOverflow ===
          "ellipsis",
        cellRight: cell.getBoundingClientRect().right,
        title: box.getAttribute("title") ?? textEl.getAttribute("title") ?? "",
      });
    };
    const rows = [...document.querySelectorAll<HTMLElement>(".category-row")].filter((r) =>
      /Wide /.test(r.textContent ?? ""),
    );
    for (const row of rows) {
      const nm = (row.querySelector(".category-name")?.textContent ?? "").slice(0, 12);
      const a = row.querySelector<HTMLElement>(".cell-assigned .assigned-box .amount");
      if (a) add(`assigned ${nm}`, a, a, row.querySelector(".cell-assigned") as Element);
      const b = row.querySelector<HTMLElement>(".activity-button");
      if (b) add(`activity ${nm}`, b, b, row.querySelector(".cell-activity") as Element);
      const p = row.querySelector<HTMLElement>(".available-pill");
      const pa = row.querySelector<HTMLElement>(".pill-amount");
      if (p && pa) add(`available ${nm}`, p, pa, row.querySelector(".cell-available") as Element);
    }
    for (const g of document.querySelectorAll<HTMLElement>(".group-row")) {
      if (!/ZZ Wide Group/.test(g.textContent ?? "")) continue;
      for (const n of g.querySelectorAll<HTMLElement>(".num")) {
        const sp = n.querySelector("span") ?? n;
        add(`group ${n.className.replace(/.*cell-(\w+).*/, "$1")}`, n, sp, n);
      }
    }
    return out;
  });
}

test("EXF-726: amounts of eight, ten and twelve characters are whole on one line at 1024x700", async ({
  page,
  request,
}) => {
  const plan = await seedWide(request);
  await page.goto(`/${plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".category-row", { hasText: "Wide Delta Savings" })).toBeVisible();
  const m = await measure(page);
  // The seeded figures are on the screen, in all three columns and in the group row.
  const texts = m.map((x) => x.text);
  for (const t of ["−$888.88", "$88,888.88", "−$888,888.88", "$888,888.88", "−$978,666.64"]) {
    expect(texts, `${t} is shown`).toContain(t);
  }
  expect(m.filter((x) => x.what.startsWith("group")).length).toBeGreaterThanOrEqual(3);
  for (const x of m) {
    expect
      .soft(
        x.scrollWidth,
        `${x.what} ${x.text}: scrollWidth ${x.scrollWidth} > clientWidth ${x.clientWidth}`,
      )
      .toBeLessThanOrEqual(x.clientWidth);
    expect.soft(x.lines, `${x.what} ${x.text}: on one line`).toBe(1);
    expect
      .soft(x.right, `${x.what} ${x.text}: right edge ${x.right} past its cell ${x.cellRight}`)
      .toBeLessThanOrEqual(x.cellRight + 0.5);
  }
  // A name keeps at least its first word; the page does not scroll sideways.
  const names = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".category-row .category-name")]
      .filter((el) => /Wide /.test(el.textContent ?? ""))
      .map((el) => {
        const t = el.firstChild;
        const r = document.createRange();
        r.setStart(t as Node, 0);
        r.setEnd(t as Node, (el.textContent ?? "").indexOf(" "));
        return {
          text: el.textContent,
          wordRight: r.getBoundingClientRect().right,
          boxRight: el.getBoundingClientRect().right,
        };
      }),
  );
  expect(names).toHaveLength(4);
  for (const n of names)
    expect(n.wordRight, `${n.text}: first word`).toBeLessThanOrEqual(n.boxRight + 0.5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("EXF-726: eight characters (the ticket's amounts) are whole on one line at 1024x700", async ({
  page,
  request,
}) => {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("eight") });
  const plan = budget.id as string;
  const account = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ Eight",
      type: "checking",
      balance: 0,
      date: TODAY,
    })
  ).account.id as string;
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, {
      name: "ZZ Wide Group",
    })
  ).category_group.id as string;
  const id = (
    await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
      group_id: group,
      name: "Wide Alpha Groceries",
    })
  ).category.id as string;
  await call(request, "PATCH", `/api/v1/budgets/${plan}/months/${MONTH}/categories/${id}`, {
    assigned: 1200000,
  });
  await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
    account_id: account,
    date: TODAY,
    amount: -1306500,
    category_id: id,
    payee_name: "ZZ Payee",
  });
  await page.goto(`/${plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".category-row", { hasText: "Wide Alpha Groceries" })).toBeVisible();
  const m = await measure(page);
  expect(m.map((x) => x.text)).toEqual(
    expect.arrayContaining(["$1,200.00", "−$1,306.50", "−$106.50"]),
  );
  for (const x of m) {
    expect
      .soft(
        x.scrollWidth,
        `${x.what} ${x.text}: scrollWidth ${x.scrollWidth} > clientWidth ${x.clientWidth}`,
      )
      .toBeLessThanOrEqual(x.clientWidth);
    expect.soft(x.lines, `${x.what} ${x.text}: on one line`).toBe(1);
    expect
      .soft(x.right, `${x.what} ${x.text}: right edge ${x.right} past its cell ${x.cellRight}`)
      .toBeLessThanOrEqual(x.cellRight + 0.5);
  }
});

test("EXF-726: fourteen characters in another format never wrap; they are cut only with an ellipsis and a title", async ({
  page,
  request,
}) => {
  const plan = await seedWide(request, [{ name: "Wide Echo Rent", spent: 8888888880 }]);
  await patchPlan(request, plan, {
    currency_format: { iso_code: "EUR", example_format: "123.456,78", symbol_placement: "after" },
  });
  await page.goto(`/${plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".category-row", { hasText: "Wide Echo Rent" })).toBeVisible();
  const m = (await measure(page)).filter(
    (x) => x.what.endsWith("Wide Echo Re") && !x.what.startsWith("assigned"),
  );
  expect(m.map((x) => x.what.split(" ")[0]).sort()).toEqual(["activity", "available"]);
  for (const x of m) {
    expect(x.text).toBe("−8.888.888,88€");
    expect(x.lines, `${x.what}: one line`).toBe(1);
    expect(x.ellipsis, `${x.what}: a cut amount ends in an ellipsis`).toBe(true);
    expect(x.title, `${x.what}: title holds the amount`).toContain("−8.888.888,88€");
    // The text is cut (an ellipsis): its box, not the clipped text, lies inside the cell.
    expect(x.boxRight, `${x.what}: right edge`).toBeLessThanOrEqual(x.cellRight + 0.5);
  }
  // The group row's total of the long amount and the page: no sideways scroll, no wrap.
  const all = await measure(page);
  for (const x of all.filter((y) => y.what.startsWith("group"))) {
    expect(x.lines, `${x.what} ${x.text}: one line`).toBe(1);
    expect(x.title, `${x.what}: title`).toBe(x.text);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("EXF-726 polish P1: an Uncategorized Activity of thirteen characters stays on one line with a title", async ({
  page,
  request,
}) => {
  const plan = await seedWide(request);
  const acct = (await call(request, "GET", `/api/v1/budgets/${plan}/accounts`)).accounts[0]
    .id as string;
  await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
    account_id: acct,
    date: TODAY,
    amount: -9777777760,
    category_id: null,
    payee_name: "ZZ Payee",
  });
  await page.goto(`/${plan}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  const span = page.locator(".uncategorized-row .cell-activity > span");
  await expect(span).toHaveText("−$9,777,777.76");
  // Source: every Activity amount span is display block, nowrap, overflow hidden, ellipsis (measured live, 1024 and 1440).
  const r = await span.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      h: el.getBoundingClientRect().height,
      fw: cs.fontWeight,
      fv: cs.fontVariantNumeric,
      ws: cs.whiteSpace,
      ov: cs.overflow,
      to: cs.textOverflow,
      title: el.title,
    };
  });
  // Source: Activity amounts are 14px / weight 500 / tabular-nums (measured live).
  expect(r).toMatchObject({
    fw: "500",
    fv: "tabular-nums",
    ws: "nowrap",
    ov: "hidden",
    to: "ellipsis",
    title: "−$9,777,777.76",
  });
  expect(r.h).toBeLessThan(20);
});
