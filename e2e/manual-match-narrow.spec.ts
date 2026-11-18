import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { stubManualMatch } from "./support/manual-match-stub";
import { call, realClick } from "./support/register-seed";
import { daysAgo } from "./support/view-settings";

// EXF-464 at 1024x700: the icon stays in its cell, the panel lies inside the window, every cut cell has an
// ellipsis and a title, and the bar's buttons stay in the bar. Not compared with the source.

test.use({ viewport: { width: 1024, height: 700 } });

const LONG = "ZZ Bank Cafe With A Long Name For Narrow Width Display";
const rows = (page: Page) => page.locator(".register-table tbody tr");
const row = (page: Page, payee: string) => rows(page).filter({ hasText: payee });
const check = (page: Page, payee: string) =>
  row(page, payee).getByRole("checkbox", { name: "Select transaction" });
const bar = (page: Page, name: string) =>
  page
    .getByRole("toolbar", { name: "Selection actions" })
    .getByRole("button", { name, exact: true });
const ICON = "This transaction has a matched transaction";

async function seed(request: Parameters<typeof call>[0]) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("match-narrow"),
  });
  const plan = budget.id as string;
  const checking = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ Checking",
      type: "checking",
      balance: 100000,
      date: daysAgo(30),
    })
  ).account.id as string;
  const add = async (payee: string, amount: number, days: number, extra = {}) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: checking,
        date: daysAgo(days),
        amount,
        payee_name: payee,
        ...extra,
      })
    ).transaction.id as string;
  const entry = await add("ZZ Cafe", -12340, 5);
  const imp = await add(LONG, -13000, 2, { approved: false });
  const preEntry = await add("ZZ Pre Entry", -5000, 12);
  const preImp = await add("ZZ Pre Bank", -5500, 11, { approved: false });
  return { plan, checking, entry, imp, preEntry, preImp };
}

const barFits = (page: Page) =>
  page.evaluate(() => {
    const inner = document.querySelector(".register-action-bar-inner")?.getBoundingClientRect();
    if (!inner) return "no bar";
    const outside = [...document.querySelectorAll(".register-action-bar-inner button")].filter(
      (b) => {
        const r = b.getBoundingClientRect();
        return r.left < inner.left - 0.5 || r.right > inner.right + 0.5;
      },
    );
    const inWindow = inner.left >= 0 && inner.right <= window.innerWidth;
    return outside.length === 0 && inWindow
      ? "ok"
      : `outside ${outside.length}, window ${inWindow}`;
  });

test("the icon, the panel and the bar fit at 1024x700", async ({ page, request }) => {
  const s = await seed(request);
  await stubManualMatch(page, [
    { entry: s.preEntry, imp: s.preImp, matched: true },
    { entry: s.entry, imp: s.imp },
  ]);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const icon = row(page, "ZZ Pre Entry").getByRole("button", { name: ICON, exact: true });
  await expect(icon).toBeVisible();
  // the icon's box is inside its cell
  const inCell = await icon.evaluate((el) => {
    const c = el.closest("td.cell-attention")?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return !!c && r.left >= c.left - 0.5 && r.right <= c.right + 0.5;
  });
  expect(inCell).toBe(true);

  await realClick(page, icon);
  const panel = page.getByRole("dialog", { name: "Matched Transactions", exact: true });
  await expect(panel).toBeVisible();
  const box = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      cut: [...el.querySelectorAll("td")]
        .filter((td) => td.scrollWidth > td.clientWidth)
        .filter(
          (td) =>
            getComputedStyle(td).textOverflow !== "ellipsis" ||
            td.getAttribute("title") !== (td.textContent ?? ""),
        )
        .map((td) => td.textContent),
    };
  });
  expect(box).toEqual({ inside: true, cut: [] });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // the bar with Match, and with Unmatch
  await realClick(page, check(page, "ZZ Cafe"));
  await realClick(page, check(page, LONG));
  await expect(bar(page, "Match")).toBeVisible();
  expect(await barFits(page)).toBe("ok");
  await realClick(page, check(page, "ZZ Cafe"));
  await realClick(page, check(page, LONG));
  await realClick(page, check(page, "ZZ Pre Entry"));
  await expect(bar(page, "Unmatch")).toBeVisible();
  expect(await barFits(page)).toBe("ok");
});
