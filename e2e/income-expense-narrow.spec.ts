import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { addAccount, newPlan, openReport, seedExample } from "./support/reflect";
import { seedSpendingExample, setRange } from "./support/spending-breakdown-seed";

// Today is 2026-11-15 12:00 in the browser (openReport). EXF-625, EXF-626.

async function post(request: APIRequestContext, url: string, data: unknown) {
  const res = await request.post(url, { headers: await authHeaders(), data });
  expect(res.status(), url).toBeLessThan(300);
  return (await res.json()).data;
}

/** Five months, Jul to Nov 2026: income from two payees, spending in two groups (invented names). */
async function seedNarrow(request: APIRequestContext) {
  const { id } = await newPlan(request, "ie-narrow");
  const chk = await addAccount(request, id, "N Checking", "checking", 0, "2026-06-01");
  const cats: Record<string, string> = {};
  for (const [g, c] of [
    ["N Home", "N Rent"],
    ["N Daily", "N Groceries"],
  ] as const) {
    const grp = (await post(request, `/api/v1/budgets/${id}/category_groups`, { name: g }))
      .category_group;
    cats[c] = (
      await post(request, `/api/v1/budgets/${id}/categories`, { group_id: grp.id, name: c })
    ).category.id;
  }
  for (const m of ["07", "08", "09", "10", "11"]) {
    const tx = (data: Record<string, unknown>) =>
      post(request, `/api/v1/budgets/${id}/transactions`, { account_id: chk, ...data });
    await tx({
      date: `2026-${m}-05`,
      amount: 2000000,
      payee_name: "N Employer",
      inflow_to_ready_to_assign: true,
    });
    await tx({
      date: `2026-${m}-05`,
      amount: 1000000,
      payee_name: "N Side Work",
      inflow_to_ready_to_assign: true,
    });
    await tx({
      date: `2026-${m}-10`,
      amount: -1200000,
      payee_name: "N Landlord",
      category_id: cats["N Rent"],
    });
    await tx({
      date: `2026-${m}-10`,
      amount: -350250,
      payee_name: "N Market",
      category_id: cats["N Groceries"],
    });
  }
  await setRange(request, id, "income-expense", "2026-07-01", "2026-11-01");
  return id;
}

const totalHeader = (p: Page) => p.getByRole("columnheader", { name: "TOTAL", exact: true });

/** Waits for the table, then until the TOTAL header stops moving. */
async function ready(page: Page) {
  await expect(page.getByRole("rowheader", { name: "Net Income", exact: true })).toBeVisible();
  await expect(totalHeader(page)).toBeVisible();
  let prev = "";
  await expect
    .poll(async () => {
      const b = JSON.stringify(await totalHeader(page).boundingBox());
      const same = b === prev;
      prev = b;
      await page.waitForTimeout(100);
      return same;
    })
    .toBe(true);
}

const measure = (page: Page) =>
  page.evaluate(() => {
    const rect = (el: Element) => el.getBoundingClientRect();
    const labels = [...document.querySelectorAll<HTMLElement>("tbody th.ie-first")]
      .filter((th) => !th.querySelector(".ie-sr"))
      .map((th) => {
        const el = th.querySelector<HTMLElement>(".ie-label") ?? th;
        const cs = getComputedStyle(el);
        return {
          text: el.textContent ?? "",
          title: th.getAttribute("title"),
          shortened: el.scrollWidth > el.clientWidth,
          ellipsis: cs.textOverflow === "ellipsis" && cs.overflowX === "hidden",
        };
      });
    const total = [...document.querySelectorAll("tbody tr")]
      .map((r) => r.querySelector("td.ie-amt:last-child"))
      .filter((td): td is Element => !!td)
      .map((td) => {
        const el =
          td.querySelector<HTMLElement>("button.ie-btn") ?? (td.firstElementChild as HTMLElement);
        return el.scrollWidth > el.clientWidth;
      });
    const box = document.querySelector(".ie-scroll") as HTMLElement;
    const heads = [...document.querySelectorAll("thead th")];
    const tot = rect(heads[heads.length - 1] as Element);
    const employer = [...document.querySelectorAll("tbody th.ie-first")].find(
      (th) => th.textContent === "N Employer",
    ) as Element;
    return {
      labels,
      total,
      box: {
        left: rect(box).left,
        right: rect(box).right,
        clientWidth: box.clientWidth,
        scrollWidth: box.scrollWidth,
        scrollLeft: box.scrollLeft,
      },
      totalHeader: { left: tot.left, right: tot.right, width: tot.width },
      headerRights: heads.map((h) => rect(h).right),
      employerX: rect(employer).left,
      doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    };
  });

test("625 at 1024×700 every TOTAL amount is whole and the table scrolls by whole columns", async ({
  page,
  request,
}) => {
  const id = await seedNarrow(request);
  await page.setViewportSize({ width: 1024, height: 700 });
  await openReport(page, id, "income-expense");
  await ready(page);
  const m = await measure(page);
  expect(m.total.length).toBeGreaterThan(0);
  expect(m.total.every((o) => !o)).toBe(true);
  expect(m.doc[0]).toBeLessThanOrEqual(m.doc[1] as number);
  const fits = m.totalHeader.right <= m.box.right + 1;
  if (!fits) {
    // Scrolls sideways by at least one whole column.
    expect(m.box.scrollWidth - m.box.clientWidth).toBeGreaterThanOrEqual(m.totalHeader.width - 1);
    // At scroll 0 the box's right edge is a clean cut between two columns.
    const edge = m.box.left + m.box.clientWidth;
    expect(m.headerRights.some((r) => Math.abs(r - edge) <= 1)).toBe(true);
    await page.locator(".ie-scroll").evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect.poll(async () => (await measure(page)).box.scrollLeft).toBeGreaterThan(0);
    const end = await measure(page);
    expect(end.totalHeader.right).toBeLessThanOrEqual(end.box.right + 1);
    expect(end.totalHeader.left).toBeGreaterThanOrEqual(end.box.left - 1);
    expect(end.employerX).toBe(m.employerX);
  }
});

test("626 first-column labels are whole or end in an ellipsis with a tooltip, at 1024×700 and 1440×900", async ({
  page,
  request,
}) => {
  const id = await seedNarrow(request);
  await page.setViewportSize({ width: 1024, height: 700 });
  await openReport(page, id, "income-expense");
  await ready(page);
  const m = await measure(page);
  expect(m.labels.length).toBeGreaterThan(8);
  for (const l of m.labels) {
    expect(!l.shortened || l.ellipsis, `${l.text} is cut without an ellipsis`).toBe(true);
    // A tooltip only where the label is shortened (the source shows none on whole labels).
    expect(l.title, `${l.text} tooltip`).toBe(l.shortened ? l.text : null);
  }
  for (const name of [
    "All Income Sources",
    "Total All Income Sources",
    "Total Income",
    "Total Expenses",
    "Net Income",
    "N Employer",
    "N Side Work",
    "N Home",
    "N Daily",
  ]) {
    const l = m.labels.find((x) => x.text === name);
    expect(l, name).toBeTruthy();
    expect(l?.shortened, `${name} is whole`).toBe(false);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  const wide = await measure(page);
  expect(wide.labels.filter((l) => l.shortened)).toEqual([]);
  expect(wide.total.every((o) => !o)).toBe(true);
  expect(wide.box.scrollWidth).toBeLessThanOrEqual(wide.box.clientWidth);
});

test("625 at 1440×900 the column widths are the pre-change flex widths", async ({
  page,
  request,
}) => {
  const id = await seedNarrow(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReport(page, id, "income-expense");
  await ready(page);
  const r = await page.evaluate(() => {
    const box = document.querySelector(".ie-scroll") as HTMLElement;
    const heads = [...document.querySelectorAll("thead th")];
    return {
      width: box.clientWidth,
      first: heads[0]?.getBoundingClientRect().width as number,
      amounts: heads.slice(1).map((h) => h.getBoundingClientRect().width),
    };
  });
  // The pre-change arithmetic (IncomeExpenseReport.tsx before 18409b0): base = 96 + 64 * (c + 2),
  // units = c + 5, first = 96 + 3/units * spare, other = 64 + spare/units. Equal within 0.5 px
  // (design doc acceptance 3, docs/reflect-narrow-design.md).
  const n = r.amounts.length;
  const units = n + 3;
  const spare = Math.max(0, r.width - (96 + 64 * n));
  expect(n).toBe(7); // five months, Average and TOTAL
  expect(Math.abs(r.first - (96 + (3 / units) * spare))).toBeLessThanOrEqual(0.5);
  for (const w of r.amounts) expect(Math.abs(w - (64 + spare / units))).toBeLessThanOrEqual(0.5);
});

// Design doc acceptance 7 / "Narrow-window survey": at 1024×700 nothing found on the three other reports.
const SURVEY: [string, string][] = [
  ["net-worth", "net"],
  ["spending-breakdown", "spend"],
  ["spending-trends", "spend"],
];
for (const [slug, seed] of SURVEY) {
  test(`7 narrow survey: ${slug} at 1024×700 has no cut or overlapping text`, async ({
    page,
    request,
  }) => {
    let id: string;
    if (seed === "net") {
      id = (await newPlan(request, "narrow-survey")).id;
      await seedExample(request, id);
    } else {
      id = (await seedSpendingExample(request)).plan.id;
    }
    await page.setViewportSize({ width: 1024, height: 700 });
    await openReport(page, id, slug);
    await page.waitForTimeout(2500);
    const found = await page.evaluate(() => {
      const body = document.querySelector(".reflect-body") ?? document.body;
      const out: string[] = [];
      const boxes: { text: string; r: DOMRect }[] = [];
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? "").trim();
        const el = n.parentElement;
        if (!text || !el || !el.checkVisibility()) continue;
        if (el.closest("script,style,svg,.ie-sr,.sr-only,[role=tooltip]")) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Text in a sideways-scrolling box is reached by scrolling, not cut.
        const scroller = el.closest<HTMLElement>("[class*='scroll']");
        if (r.right > window.innerWidth + 1 && !scroller) out.push(`past edge: ${text}`);
        const cs = getComputedStyle(el);
        if (
          el.scrollWidth > el.clientWidth + 1 &&
          /hidden|clip/.test(cs.overflowX) &&
          cs.textOverflow !== "ellipsis"
        )
          out.push(`cut: ${text}`);
        boxes.push({ text, r });
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = (boxes[i] as (typeof boxes)[0]).r;
          const b = (boxes[j] as (typeof boxes)[0]).r;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 1 && h > 1)
            out.push(
              `overlap: ${(boxes[i] as (typeof boxes)[0]).text} / ${(boxes[j] as (typeof boxes)[0]).text}`,
            );
        }
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth)
        out.push("page scrolls sideways");
      return out;
    });
    expect(found).toEqual([]);
  });
}
