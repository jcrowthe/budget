import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { addAccount, addTx, NOW, newPlan } from "./support/reflect";
import { seedSpendingExample } from "./support/spending-breakdown-seed";

// The browser clock is 2026-11-15 12:00; the API gets today=2026-11-15 from the web app.
const INFO = [
  "Age of Money is how long, on average, money sits in your account(s) between earning and spending it.",
  "Want to have more time to make decisions? Tired of shifting money around at the last minute? Use Age of Money to help you gauge the time between earning and spending.",
];

async function openAge(page: Page, id: string) {
  await page.clock.setFixedTime(NOW);
  await page.goto(`/${id}/reflect/age-of-money`);
  await expect(
    page.getByRole("heading", { name: "Understanding Age of Money", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("aom-current")).not.toHaveText("");
}

/** Goes to another address without leaving the page (the app's own history, as a link would). */
const goClientSide = (page: Page, url: string) =>
  page.evaluate((u) => {
    history.pushState(null, "", u);
    dispatchEvent(new PopStateEvent("popstate"));
  }, url);

async function markerCentre(page: Page, month: string) {
  const marker = page.locator(`.aom-marker[data-month="${month}"]`);
  await marker.scrollIntoViewIfNeeded();
  let box = await marker.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const next = await marker.boundingBox();
    const still = !!box && !!next && box.x === next.x && box.y === next.y;
    box = next;
    if (still) break;
  }
  const b = box as { x: number; y: number; width: number; height: number };
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Moves the real mouse to the marker (plus dx, dy), after checking the hover column is the element there. */
async function hoverMonth(page: Page, month: string, dx = 0, dy = 0) {
  const c = await markerCentre(page, month);
  const x = c.x + dx;
  const y = c.y + dy;
  const hit = await page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el?.matches("rect.aom-hover") ? el.getAttribute("data-month") : null;
    },
    [x, y],
  );
  expect(hit).toBe(month);
  await page.mouse.move(x, y);
  return { x, y, c };
}

const tooltip = (page: Page) => page.locator(".aom-tooltip");

test("553-1 a plan with fewer than 10 outflows shows the empty state", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request, "aom-e");
  const chk = await addAccount(request, plan.id, "E Checking", "checking", 500000, "2026-11-01");
  for (const d of ["02", "03", "04"]) await addTx(request, plan.id, chk, `2026-11-${d}`, -10000);
  const res = await request.get(
    `/api/v1/budgets/${plan.id}/reports/age-of-money?today=2026-11-15`,
    { headers: await authHeaders() },
  );
  expect((await res.json()).data).toEqual({ current_days: null, months: [] });
  await openAge(page, plan.id);
  await expect(page.getByTestId("aom-current")).toHaveText("—");
  const status = page.getByRole("status");
  await expect(
    status.getByRole("heading", { name: "Spend more money!", exact: true }),
  ).toBeVisible();
  await expect(status.locator("p")).toHaveText(
    "Strange advice, we know. Budget needs a minimum of 10 transactions to calculate your Age of Money.",
  );
  await expect(page.locator(".aom-chart svg")).toHaveCount(0);
  await expect(page.locator(".aom-info")).toBeVisible();
});

test("553-2 553-3 the chart, its labels and the tooltip", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  await openAge(page, plan.id);
  await expect(page.getByTestId("aom-current")).toHaveText("122 days");
  await expect(page.locator(".aom-marker")).toHaveCount(2);
  await expect(page.locator('.aom-marker[data-month="2026-11-01"]')).toBeVisible();
  await expect(page.locator(".aom-xlabel").first().locator("tspan")).toHaveText(["Oct", "2026"]);
  await expect(page.locator(".aom-xlabel").last().locator("tspan")).toHaveText(["Nov", "2026"]);
  await expect(page.locator(".aom-ytick")).toHaveText(["0 days", "140 days"]);

  const oct = await hoverMonth(page, "2026-10-01");
  await expect(tooltip(page).locator("div")).toHaveText(["Oct 2026", "114 days"]);
  const box = (await tooltip(page).boundingBox()) as { y: number };
  expect(box.y).toBeGreaterThan(oct.c.y);
  const octMarker = page.locator('.aom-marker[data-month="2026-10-01"]');
  await expect(octMarker).toHaveClass(/selected/);
  await expect(octMarker).toHaveCSS("fill", "rgb(147, 213, 62)");
  const url = page.url();
  await page.mouse.click(oct.x, oct.y);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(page.url()).toBe(url);

  // EXF-621: the hover columns end at the plot's top edge, so the high point is 40px above the marker,
  // or 1px inside the plot's top edge where the marker sits less than 40px under it.
  const plotTop = (await page.locator(".aom-chart line.aom-grid:not(.aom-base)").boundingBox())
    ?.y as number;
  const nov = await markerCentre(page, "2026-11-01");
  for (const dy of [0, 6, -Math.min(40, nov.y - (plotTop + 1))]) {
    await page.mouse.move(oct.x, oct.y);
    await hoverMonth(page, "2026-11-01", 0, dy);
    await expect(tooltip(page).locator("div")).toHaveText(["Nov 2026", "122 days"]);
  }
  await expect(page.locator('.aom-marker[data-month="2026-11-01"]')).toHaveClass(/selected/);
  expect((await markerCentre(page, "2026-10-01")).y).toBeGreaterThanOrEqual(plotTop + 41);
  await hoverMonth(page, "2026-10-01", 0, -40);
  await expect(tooltip(page).locator("div")).toHaveText(["Oct 2026", "114 days"]);
});

test("621 the Current value is outside the hover columns", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  await openAge(page, plan.id);
  await expect(page.getByTestId("aom-current")).toHaveText("122 days");
  await expect(page.locator('.aom-marker[data-month="2026-11-01"]')).toBeVisible();
  // The value element is a block as wide as the card: aim at its text, measured with a Range.
  const v = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="aom-current"]') as Element;
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const svg = (await page.locator(".aom-chart svg").boundingBox()) as { x: number };
  const x = v.x + v.width - 8;
  const y = v.y + v.height / 2;
  expect(x).toBeGreaterThanOrEqual(svg.x + 72);
  const onValue = await page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      const cur = document.querySelector('[data-testid="aom-current"]');
      return !!el && !!cur && cur.contains(el);
    },
    [x, y],
  );
  expect(onValue).toBe(true);
  await page.mouse.move(x, y);
  await page.waitForTimeout(300);
  await expect(tooltip(page)).toHaveCount(0);
  await expect(page.locator(".aom-marker.selected")).toHaveCount(0);
  await page.mouse.move(v.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(v.x + v.width - 2, y, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toContain("122 days");
});

test("553-4 the info card and no filters or export", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  await openAge(page, plan.id);
  await expect(page.locator(".aom-info h2")).toHaveText("Understanding Age of Money");
  await expect(page.locator(".aom-info-content p")).toHaveText(INFO);
  for (const name of ["Export", "Previous Period", "All Accounts", "All Categories"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
});

test("553-7 a plan switch never shows the first plan's value", async ({ page, request }) => {
  const { plan: x } = await seedSpendingExample(request);
  const y = await newPlan(request, "aom-y");
  const chk = await addAccount(request, y.id, "Y Checking", "checking", 500000, "2026-11-01");
  for (const d of ["02", "03", "04"]) await addTx(request, y.id, chk, `2026-11-${d}`, -10000);
  await openAge(page, x.id);
  await expect(page.getByTestId("aom-current")).toHaveText("122 days");
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(`**/api/v1/budgets/${y.id}/reports/age-of-money*`, async (route) => {
    await held;
    await route.continue();
  });
  await goClientSide(page, `/${y.id}/reflect/age-of-money`);
  await expect(page).toHaveURL(`/${y.id}/reflect/age-of-money`);
  for (const wait of [0, 1000, 1000]) {
    await page.waitForTimeout(wait);
    const body = page.locator("body");
    for (const stale of ["122 days", "114 days", "Oct 2026"]) {
      await expect(body).not.toContainText(stale);
    }
  }
  release();
  await expect(page.getByTestId("aom-current")).toHaveText("—");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("553-3 narrow window: the tooltip stays inside", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  await page.setViewportSize({ width: 1024, height: 700 });
  await openAge(page, plan.id);
  await expect(page.locator('.aom-marker[data-month="2026-11-01"]')).toBeVisible();
  await hoverMonth(page, "2026-11-01");
  await expect(tooltip(page).locator("div")).toHaveText(["Nov 2026", "122 days"]);
  const box = (await tooltip(page).boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
  expect(box.y + box.height).toBeLessThanOrEqual(700);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
