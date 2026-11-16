import {
  assign,
  autoCard,
  chip,
  fixedClock,
  MONTHLY,
  panel,
  putTarget,
  realClick,
  removePlan,
  type Seed,
  seedPlan,
} from "./auto-assign.fixtures";
import { expect, test } from "./fixtures";
import { GROCERIES, openPlan, PHONE, RENT } from "./plan-panel.fixtures";

test.use({ timezoneId: "UTC" });
const { at, today } = fixedClock();

let s: Seed;
test.beforeEach(async ({ request, page }) => {
  await page.clock.setFixedTime(at);
  s = await seedPlan(request, "auto-assign-layout");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

const notesTop = async (page: import("@playwright/test").Page) => {
  const b = await panel(page).locator(".panel-card", { hasText: "Notes" }).last().boundingBox();
  if (!b) throw new Error("Notes card not visible");
  return Math.round(b.y);
};

test("the Notes card does not move while the Auto-Assign preview loads or the selection changes", async ({
  page,
}) => {
  await openPlan(page, s);
  // Hold every preview read back for one second.
  await page.route(/\/auto-assign\?/, async (route) => {
    if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 1000));
    await route.continue();
  });
  for (const name of [RENT, PHONE]) {
    await page.getByRole("checkbox", { name, exact: true }).click();
    await expect(panel(page).getByRole("heading", { name, exact: true })).toBeVisible();
    const during = await notesTop(page);
    // The preview has arrived once a button carries an amount.
    await expect(
      panel(page).locator("button.auto-assign-option strong", { hasText: "$" }).first(),
    ).toBeVisible({ timeout: 5000 });
    expect(await notesTop(page), `after the preview of ${name}`).toBe(during);
    await page.getByRole("checkbox", { name, exact: true }).click();
  }
  // Moving the selection straight from one category to another.
  await page.getByRole("checkbox", { name: RENT, exact: true }).click();
  await expect(
    panel(page).locator("button.auto-assign-option strong", { hasText: "$" }).first(),
  ).toBeVisible({ timeout: 5000 });
  const before = await notesTop(page);
  await page.getByRole("checkbox", { name: RENT, exact: true }).click();
  await page.getByRole("checkbox", { name: PHONE, exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: PHONE, exact: true })).toBeVisible();
  expect(await notesTop(page), "right after the selection moved").toBe(before);
  await expect(
    panel(page).locator("button.auto-assign-option strong", { hasText: "$" }).first(),
  ).toBeVisible({ timeout: 5000 });
  expect(await notesTop(page), "after the new preview").toBe(before);
});

const cardHeight = async (page: import("@playwright/test").Page) =>
  (await autoCard(page).boundingBox())?.height ?? 0;

test("EXF-616: the card has the source's height in every state", async ({ page, request }) => {
  // RENT is underfunded (target 100.00, nothing assigned); GROCERIES is overfunded (target 100.00, 150.00 assigned).
  await putTarget(request, s, RENT, MONTHLY, today);
  await putTarget(request, s, GROCERIES, MONTHLY, today);
  await assign(request, s, GROCERIES, 150000);
  await openPlan(page, s);
  // Underfunded and Reduce Overfunding both show: 8 rows in three groups (source arithmetic).
  expect(Math.abs((await cardHeight(page)) - 386)).toBeLessThanOrEqual(1);
  // One fully funded category ticked: 6 rows, no Underfunded.
  await page.getByRole("checkbox", { name: PHONE, exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: PHONE, exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs((await cardHeight(page)) - 304)).toBeLessThanOrEqual(1);
  await page.getByRole("checkbox", { name: PHONE, exact: true }).click();
  // Without the overfunded category the card has 7 rows: 352.
  await assign(request, s, GROCERIES, 100000);
  await page.reload();
  await expect(page.locator(".category-row").first()).toBeVisible();
  await expect.poll(async () => Math.abs((await cardHeight(page)) - 352)).toBeLessThanOrEqual(1);
});

test("EXF-616: the height and the Notes card hold while the preview is held", async ({
  page,
  request,
}) => {
  await putTarget(request, s, RENT, MONTHLY, today);
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await openPlan(page, s);
  await page.route(/\/auto-assign\?/, async (route) => {
    if (route.request().method() === "GET") await gate;
    await route.continue();
  });
  await page.getByRole("checkbox", { name: RENT, exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: RENT, exact: true })).toBeVisible();
  await expect(
    panel(page).locator("#panel-auto-assign button.auto-assign-option").first(),
  ).toBeVisible();
  const held = await cardHeight(page);
  const notes = await notesTop(page);
  release();
  await expect(
    panel(page).locator("button.auto-assign-option strong", { hasText: "$" }).first(),
  ).toBeVisible();
  expect(await cardHeight(page)).toBe(held);
  expect(await notesTop(page)).toBe(notes);
});

test("EXF-616: an empty view shows its message at once, in the card and in the Assign popover", async ({
  page,
}) => {
  await openPlan(page, s);
  await page.route(/\/auto-assign\?/, async (route) => {
    if (route.request().method() === "GET") await new Promise(() => {});
    await route.continue();
  });
  await page.evaluate(() => {
    const w = window as unknown as { drawn: number };
    w.drawn = 0;
    new MutationObserver((list) => {
      for (const m of list) {
        for (const n of m.addedNodes) {
          if (
            n instanceof Element &&
            (n.matches(".auto-assign-option") || n.querySelector(".auto-assign-option"))
          )
            w.drawn++;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await realClick(page, chip(page, "Snoozed"));
  await expect(panel(page).getByRole("button", { name: "View All Categories" })).toBeVisible();
  await expect(panel(page).locator(".auto-assign-option")).toHaveCount(0);
  await realClick(page, page.getByRole("button", { name: "Assign", exact: true }));
  const dlg = page.getByRole("dialog", { name: "Assign", exact: true });
  await realClick(page, dlg.getByRole("tab", { name: "Auto", exact: true }));
  await expect(dlg.getByRole("button", { name: "View All Categories" })).toBeVisible();
  await expect(dlg.locator(".auto-assign-option")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { drawn: number }).drawn)).toBe(0);
});

test("EXF-624: nothing underfunded hides Underfunded and Reduce Overfunding, in the card and in the popover", async ({
  page,
}) => {
  await openPlan(page, s);
  await expect(panel(page).locator("button.auto-assign-option").first()).toBeVisible();
  for (const label of ["Underfunded", "Reduce Overfunding"]) {
    await expect(
      panel(page).locator("button.auto-assign-option > span", {
        hasText: new RegExp(`^${label}$`),
      }),
    ).toHaveCount(0);
  }
  await realClick(page, page.getByRole("button", { name: "Assign", exact: true }));
  const dlg = page.getByRole("dialog", { name: "Assign", exact: true });
  await realClick(page, dlg.getByRole("tab", { name: "Auto", exact: true }));
  await expect(dlg.locator("button.auto-assign-option").first()).toBeVisible();
  await expect(
    dlg.locator("button.auto-assign-option > span", { hasText: /^Underfunded$/ }),
  ).toHaveCount(0);
  await expect(
    dlg.locator("button.auto-assign-option > span", { hasText: /^Reduce Overfunding$/ }),
  ).toHaveCount(0);
});

test("EXF-616 25b: with one ticked, the Available Balance header holds title, chevron and pill on one row", async ({
  page,
}) => {
  await openPlan(page, s);
  await page.getByRole("checkbox", { name: PHONE, exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: PHONE, exact: true })).toBeVisible();
  const head = panel(page).locator(".card-roll-up", { hasText: "Available Balance" });
  // Design doc, "Auto-Assign card (live)": the header is one row, 54.8 px in the source (live compare, 25b).
  const hb = await head.boundingBox();
  expect(Math.abs((hb?.height ?? 0) - 54.8)).toBeLessThanOrEqual(2);
  const title = await head.locator(".panel-card-title").boundingBox();
  const pill = await head.locator(".available-pill").boundingBox();
  // On one row: the pill's vertical middle lies inside the title's box.
  const mid = (pill?.y ?? 0) + (pill?.height ?? 0) / 2;
  expect(mid).toBeGreaterThanOrEqual(title?.y ?? 0);
  expect(mid).toBeLessThanOrEqual((title?.y ?? 0) + (title?.height ?? 0));
  // The chevron sits between the title and the pill on that row.
  const chev = await head.locator("svg").first().boundingBox();
  expect(chev?.x ?? 0).toBeGreaterThanOrEqual((title?.x ?? 0) - 1);
  expect((chev?.x ?? 0) + (chev?.width ?? 0)).toBeLessThanOrEqual((pill?.x ?? 0) + 1);
});

test("EXF-616 25c: a category row's pill is 22 px tall with 7 px side padding", async ({
  page,
}) => {
  await openPlan(page, s);
  const pill = page.locator(".category-row", { hasText: RENT }).locator(".available-pill").first();
  await expect(pill).toBeVisible();
  // Design doc, "Row": the pill is 22 px tall, padding 2px 7px (live compare of the source's plan row, 25c).
  expect(Math.round((await pill.boundingBox())?.height ?? 0)).toBe(22);
  const pad = await pill.evaluate((el) => {
    const c = getComputedStyle(el);
    return [c.paddingLeft, c.paddingRight];
  });
  expect(pad).toEqual(["7px", "7px"]);
});

test("EXF-616 24: realClick waits for the height to settle before clicking the centre", async ({
  page,
}) => {
  await page.setContent(`<style>body{margin:0}#b{position:absolute;left:20px;top:20px;width:100px;height:20px}</style>
    <button id="b">x</button>
    <script>
      window.clickY = null;
      document.getElementById('b').addEventListener('click', e => { window.clickY = e.clientY; });
      setTimeout(() => { document.getElementById('b').style.height = '200px'; }, 30);
    </script>`);
  await realClick(page, page.locator("#b"));
  // x, y and width never change; only the height does. The click lands on the final centre (20 + 200 / 2).
  expect(await page.evaluate(() => (window as unknown as { clickY: number }).clickY)).toBe(120);
});
