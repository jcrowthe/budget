import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { newPlanDialog, newPlanField, openNewPlan } from "./support/new-plan-seed";
import { field, openSettings, settingsDialog } from "./support/plan-formats-seed";

const SIZES = [
  [1440, 900],
  [1024, 700],
] as const;
const CURRENCIES = ["USD", "EUR", "CHF", "SEK", "KWD"];
const PLACEMENTS = ["before", "after", "none"];

/** The chosen label's text width plus the native arrow against the select's room; EXF-746. */
async function measure(select: Locator) {
  return select.evaluate((el) => {
    const s = el as HTMLSelectElement;
    const cs = getComputedStyle(s);
    const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = (s.selectedOptions[0] as HTMLOptionElement).text;
    return {
      text,
      need: ctx.measureText(text).width + 24,
      room: s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      title: s.title,
    };
  });
}

async function insideViewport(page: Page, dialog: Locator) {
  const b = await dialog.boundingBox();
  const vp = page.viewportSize();
  if (!b || !vp) throw new Error("no box");
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
}

async function walk(page: Page, dialog: Locator, currency: Locator, placement: Locator) {
  await page.evaluate(() => document.fonts.ready);
  for (const code of CURRENCIES) {
    await currency.selectOption(code);
    for (const p of PLACEMENTS) {
      await placement.selectOption(p);
      const m = await measure(placement);
      expect(
        m.need,
        `${code} ${p}: "${m.text}" needs ${m.need}, room ${m.room}`,
      ).toBeLessThanOrEqual(m.room);
      expect(m.title).toBe(m.text);
      await insideViewport(page, dialog);
    }
  }
}

for (const [w, h] of SIZES) {
  test(`EXF-746 Plan Settings placement label fits at ${w}x${h}`, async ({ page, request }) => {
    await page.setViewportSize({ width: w, height: h });
    const name = testName("placement");
    const res = await request.post("/api/v1/budgets", {
      headers: await authHeaders(),
      data: { name },
    });
    const id = (await res.json()).data.budget.id as string;
    await page.goto(`/${id}/budget`);
    await openSettings(page, name);
    await walk(
      page,
      settingsDialog(page),
      field(page, "Currency"),
      field(page, "Currency Placement"),
    );
  });
}

for (const [w, h] of SIZES) {
  test(`EXF-746 New Plan placement label fits at ${w}x${h}`, async ({ page, request }) => {
    await page.setViewportSize({ width: w, height: h });
    const name = testName("placement-new");
    const res = await request.post("/api/v1/budgets", {
      headers: await authHeaders(),
      data: { name },
    });
    const id = (await res.json()).data.budget.id as string;
    await page.goto(`/${id}/budget`);
    await openNewPlan(page, name);
    await walk(
      page,
      newPlanDialog(page),
      newPlanField(page, "Currency"),
      newPlanField(page, "Currency Placement"),
    );
  });
}
