import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  dbutton,
  dialog,
  newAccount,
  newPlan,
  openFromHeader,
  post,
} from "./support/account-edit-seed";
import { seedBulk } from "./support/bulk-seed";
import { mouseClick } from "./support/menu";
import { Plan } from "./support/plan-seed";
import { realClick } from "./support/register-seed";

// EXF-876: the footer buttons of every dialog share one rule; values measured on the source (dark theme).
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

const PRIMARY = "rgb(84, 91, 254)";
const PRIMARY_HOVER = "rgb(117, 131, 255)";
const SECONDARY = "rgba(117, 131, 255, 0.2)";
const SECONDARY_HOVER = "rgba(117, 131, 255, 0.27)";
const SECONDARY_LABEL = "rgb(241, 241, 255)";
const DISABLED_BG = "rgb(41, 43, 61)";
const DISABLED_LABEL = "rgb(155, 156, 170)";
const DESTRUCTIVE = "rgb(106, 16, 32)";
const DESTRUCTIVE_HOVER = "rgb(145, 35, 51)";
const DESTRUCTIVE_LABEL = "rgb(254, 237, 235)";
const GHOST_LABEL = "rgb(163, 172, 255)";

const css = (b: Locator, prop: string) =>
  b.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const bg = (b: Locator) => css(b, "background-color");

async function hoverBg(b: Locator, want: string) {
  await b.hover();
  await expect.poll(() => bg(b)).toBe(want);
}

/** Tab (real keyboard) until `b` has focus, so :focus-visible applies. */
async function tabTo(page: Page, b: Locator) {
  await page.mouse.move(0, 0);
  for (let i = 0; i < 40; i++) {
    if (await b.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("button not reached with Tab");
}

async function ring(b: Locator) {
  return b.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      style: s.outlineStyle,
      width: s.outlineWidth,
      color: s.outlineColor,
      offset: s.outlineOffset,
      shadow: s.boxShadow,
    };
  });
}

async function rest(b: Locator, want: { bg: string; color: string; fs?: string; pad?: string }) {
  expect(await bg(b)).toBe(want.bg);
  expect(await css(b, "color")).toBe(want.color);
  expect(await css(b, "height")).toBe("32px");
  expect(await css(b, "border-radius")).toBe("8px");
  expect(await css(b, "font-size")).toBe(want.fs ?? "16px");
  expect(await css(b, "padding")).toBe(want.pad ?? "6px 16px");
  expect(await css(b, "transition-property")).toContain("background-color");
  expect(await css(b, "transition-duration")).toContain("0.15s");
}

test("Export Plan: primary and secondary at rest, hover and keyboard focus", async ({
  page,
  request,
}) => {
  const plan = new Plan(request);
  await plan.create("btn");
  try {
    await page.goto(`/${plan.id}/budget`);
    await mouseClick(page, page.locator(".plan-button"));
    await mouseClick(page, page.getByRole("menuitem", { name: "Export Plan", exact: true }));
    const d = page.getByRole("dialog", { name: "Export Plan", exact: true });
    const primary = d.getByRole("button", { name: "Export", exact: true });
    const secondary = d.getByRole("button", { name: "Cancel", exact: true });
    await rest(primary, { bg: PRIMARY, color: "rgb(255, 255, 255)" });
    await rest(secondary, { bg: SECONDARY, color: SECONDARY_LABEL });
    await hoverBg(primary, PRIMARY_HOVER);
    await hoverBg(secondary, SECONDARY_HOVER);

    await tabTo(page, secondary);
    expect(await ring(secondary)).toMatchObject({
      style: "auto",
      width: "1px",
      color: PRIMARY_HOVER,
      offset: "2px",
      shadow: "none",
    });
    await tabTo(page, primary);
    expect(await ring(primary)).toMatchObject({
      style: "auto",
      width: "2px",
      color: PRIMARY_HOVER,
      offset: "2px",
      shadow: "none",
    });
    await page.screenshot({ path: "test-results/dialog-buttons-export-focus.png" });
  } finally {
    await plan.remove();
  }
});

test("Edit Memo: a disabled primary has its own colours, opacity 1, no hover change", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const row = (payee: string) =>
    page.locator(".register-table tbody tr[data-tx]").filter({ hasText: payee });
  await expect(row("ZZ Fee")).toBeVisible();
  for (const p of ["ZZ Rent", "ZZ Gas"]) {
    await realClick(
      page,
      row(p).getByRole("checkbox", { name: "Select transaction", exact: true }),
    );
  }
  await realClick(
    page,
    page
      .getByRole("toolbar", { name: "Selection actions" })
      .getByRole("button", { name: "More", exact: true }),
  );
  await realClick(
    page,
    page
      .getByRole("menu", { name: "More actions" })
      .getByRole("menuitem", { name: "Memo...", exact: true }),
  );
  const d = page.getByRole("dialog", { name: "Edit Memo (2 Transactions)" });
  const primary = d.getByRole("button", { name: "Update 2 Transactions", exact: true });
  await expect(primary).toBeDisabled();
  await rest(primary, { bg: DISABLED_BG, color: DISABLED_LABEL });
  expect(await css(primary, "opacity")).toBe("1");
  expect(await css(primary, "cursor")).toBe("auto");
  await primary.hover({ force: true });
  await page.waitForTimeout(300);
  expect(await bg(primary)).toBe(DISABLED_BG);
  await page.screenshot({ path: "test-results/dialog-buttons-memo-disabled.png" });
  await d.getByLabel("Memo").fill("x");
  await expect(primary).toBeEnabled();
  await page.mouse.move(0, 0);
  await expect.poll(() => bg(primary)).toBe(PRIMARY);
  await rest(primary, { bg: PRIMARY, color: "rgb(255, 255, 255)" });
  await hoverBg(primary, PRIMARY_HOVER);
});

test("Edit Account: destructive and ghost, enabled and disabled", async ({ page, request }) => {
  const plan = await newPlan(request);
  const open = await newAccount(request, plan, "ZZ-TEST Open", "checking", 0);
  const closed = await newAccount(request, plan, "ZZ-TEST Closed", "checking", 500);
  await post(request, `/api/v1/budgets/${plan}/accounts/${closed}/close`);

  await page.goto(`/${plan}/accounts/${open}`);
  await openFromHeader(page);
  const del = dialog(page).locator(".dialog-footer .destructive");
  await expect(del).toBeEnabled();
  await rest(del, { bg: DESTRUCTIVE, color: DESTRUCTIVE_LABEL });
  await hoverBg(del, DESTRUCTIVE_HOVER);
  await hoverBg(dbutton(page, "Cancel"), SECONDARY_HOVER);
  await hoverBg(dbutton(page, "Save"), PRIMARY_HOVER);

  await page.goto(`/${plan}/accounts/${closed}`);
  await openFromHeader(page);
  const gone = dbutton(page, "Delete");
  await expect(gone).toBeDisabled();
  await rest(gone, { bg: DISABLED_BG, color: DISABLED_LABEL });
  expect(await css(gone, "opacity")).toBe("1");
  await gone.hover({ force: true });
  await page.waitForTimeout(300);
  expect(await bg(gone)).toBe(DISABLED_BG);

  const ghost = dbutton(page, "Re-open");
  await rest(ghost, { bg: "rgba(0, 0, 0, 0)", color: GHOST_LABEL, fs: "14px", pad: "4px 8px" });
  await hoverBg(ghost, SECONDARY);
  await tabTo(page, ghost);
  expect(await ring(ghost)).toMatchObject({
    style: "auto",
    width: "1px",
    color: PRIMARY_HOVER,
    offset: "0px",
  });
});
