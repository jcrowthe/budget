import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { BANNER, seedApprove } from "./support/approve-seed";
import { call, realClick } from "./support/register-seed";
import { daysAgo, setViewSettings } from "./support/view-settings";

// EXF-463 with EXF-680, EXF-681, EXF-728, EXF-760 (riders) at 1024x700 and 1440x900. Not compared with the source:
// built from the tickets' measured values and the register as it is.

const LONG_A = "ZZ A category with a rather long name indeed";
const LONG_B = "ZZ Another category with a long name too";

async function seedRiders(request: Parameters<typeof call>[0]) {
  const s = await seedApprove(request);
  const mk = async (name: string) =>
    (
      await call(request, "POST", `/api/v1/budgets/${s.plan}/categories`, {
        group_id: s.group,
        name,
      })
    ).category.id as string;
  const a = await mk(LONG_A);
  const b = await mk(LONG_B);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: daysAgo(5),
    amount: -60000,
    payee_name: "ZZ Split Payee With A Long Name",
    subtransactions: [
      { amount: -25000, category_id: a },
      { amount: -35000, category_id: b },
    ],
  });
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: daysAgo(6),
    amount: -12000,
    transfer_account_id: s.savings,
  });
  return s;
}

const wholeOrEllipsis = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => el.scrollWidth > el.clientWidth)
      .filter((el) => {
        const cs = getComputedStyle(el);
        const t = (el.textContent ?? "").trim();
        return !(cs.textOverflow === "ellipsis" && el.getAttribute("title") === t);
      })
      .map((el) => `${el.tagName} ${el.textContent?.trim()}`),
  );

const headersOk = async (page: Page) => {
  expect(await wholeOrEllipsis(page, ".register-table thead th")).toEqual([]);
  expect(await wholeOrEllipsis(page, ".register-table thead .sort-button")).toEqual([]);
  const doc = await page.evaluate(() => [
    document.documentElement.scrollWidth <= window.innerWidth,
    (() => {
      const m = document.querySelector<HTMLElement>(".main");
      return !m || m.scrollWidth <= m.clientWidth;
    })(),
  ]);
  expect(doc).toEqual([true, true]);
};
const headerBox = async (page: Page, name: string) => {
  const b = await page.getByRole("columnheader", { name, exact: true }).boundingBox();
  if (!b) throw new Error(`no ${name}`);
  return b;
};

test.describe("at 1024x700", () => {
  test.use({ viewport: { width: 1024, height: 700 } });

  test("EXF-680: a cut split or transfer category cell has an ellipsis and a title", async ({
    page,
    request,
  }) => {
    const s = await seedRiders(request);
    for (const path of [`accounts/${s.checking}`, "accounts"]) {
      await page.goto(`/${s.plan}/${path}`);
      await expect(page.getByText("Split (Multiple Categories)...").first()).toBeVisible();
      expect(await wholeOrEllipsis(page, "td[data-field=category]")).toEqual([]);
      const title = await page
        .locator("td[data-field=category]")
        .filter({ hasText: "Split (Multiple Categories)..." })
        .first()
        .getAttribute("title");
      expect(title).toBe("Split (Multiple Categories)...");
    }
  });

  test("EXF-681: an open row's cut Payee field carries its whole text", async ({
    page,
    request,
  }) => {
    const s = await seedRiders(request);
    await page.goto(`/${s.plan}/accounts/${s.checking}`);
    const row = page.locator(".register-table tbody tr[data-tx]").filter({ hasText: "ZZ Savings" });
    await realClick(page, row.locator("td[data-field=date]"));
    await realClick(page, row.locator("td[data-field=date]"));
    const payee = page.getByRole("combobox", { name: "Payee", exact: true }).first();
    await expect(payee).toBeVisible();
    const [cut, title, value] = await payee.evaluate((el: HTMLInputElement) => [
      el.scrollWidth > el.clientWidth,
      el.title,
      el.value,
    ]);
    expect(cut).toBe(true);
    expect(title).toBe(value);
  });

  for (const state of [
    { name: "defaults", flags: true, balance: false },
    { name: "BALANCE on", flags: true, balance: true },
    { name: "flags off", flags: false, balance: false },
    { name: "flags off and BALANCE", flags: false, balance: true },
  ]) {
    test(`EXF-728 and the attention column: ZZ Checking, ${state.name}`, async ({
      page,
      request,
    }) => {
      const s = await seedRiders(request);
      await setViewSettings(request, s.plan, s.checking, {
        show_flags: state.flags,
        show_running_balance: state.balance,
      });
      await page.goto(`/${s.plan}/accounts/${s.checking}`);
      await expect(page.getByRole("region", { name: "New transactions" })).toContainText(BANNER(3));
      await headersOk(page);
      expect((await headerBox(page, "CATEGORY")).width).toBeGreaterThanOrEqual(88);
      expect((await headerBox(page, "Approval")).width).toBeCloseTo(24, 0);
      // The banner's View and the icon's menu lie inside the window.
      const view = await page
        .getByRole("region", { name: "New transactions" })
        .getByRole("button", { name: "View", exact: true })
        .boundingBox();
      expect((view?.x ?? 0) + (view?.width ?? 0)).toBeLessThanOrEqual(1024);
      await realClick(
        page,
        page.getByRole("button", { name: "This transaction needs approval" }).first(),
      );
      const m = await page.getByRole("menu", { name: "Approval", exact: true }).boundingBox();
      expect(m && m.x >= 0 && m.x + m.width <= 1024 && m.y + m.height <= 700).toBe(true);
    });
  }

  for (const flags of [true, false]) {
    test(`EXF-760: All Accounts, flags ${flags ? "on" : "off"}`, async ({ page, request }) => {
      const s = await seedRiders(request);
      await setViewSettings(request, s.plan, "all", { show_flags: flags });
      await page.goto(`/${s.plan}/accounts`);
      await expect(page.getByText("Split (Multiple Categories)...").first()).toBeVisible();
      await headersOk(page);
      expect((await headerBox(page, "CATEGORY")).width).toBeGreaterThanOrEqual(88);
      // A category cell shows "ZZ Group:" whole.
      const cell = page
        .locator("td[data-field=category]")
        .filter({ hasText: "ZZ Group: ZZ Food" })
        .first();
      const fits = await cell.evaluate((el) => {
        const c = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
        const cs = getComputedStyle(el);
        c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        return el.clientWidth >= c.measureText("ZZ Group:").width;
      });
      expect(fits).toBe(true);
      // Each header's right edge is within its cell's.
      const edges = await page.evaluate(() => {
        const ths = [...document.querySelectorAll<HTMLElement>(".register-table thead th")];
        const first = [
          ...document.querySelectorAll<HTMLElement>(".register-table tbody tr[data-tx]"),
        ][0];
        const tds = first ? [...first.children] : [];
        return ths.map((th, i) => {
          const td = tds[i];
          return td
            ? th.getBoundingClientRect().right <= td.getBoundingClientRect().right + 1
            : true;
        });
      });
      expect(edges.every(Boolean)).toBe(true);
    });
  }
});

test.describe("at 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("every header is whole", async ({ page, request }) => {
    const s = await seedRiders(request);
    for (const path of [`accounts/${s.checking}`, "accounts"]) {
      await page.goto(`/${s.plan}/${path}`);
      await expect(page.getByText("Split (Multiple Categories)...").first()).toBeVisible();
      const cut = await page
        .locator(".register-table thead th, .register-table thead .sort-button")
        .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).length);
      expect(cut).toBe(0);
    }
  });
});
