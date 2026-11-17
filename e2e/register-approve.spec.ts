import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { BANNER, seedApprove, stubReject } from "./support/approve-seed";
import { call, realClick } from "./support/register-seed";
import { setViewSettings, viewSettingsOf } from "./support/view-settings";

// EXF-463 (screens). Nothing was compared with the source: built from the ticket's measured values.

const NEEDS_APPROVAL = "This transaction needs approval";
const TIP = "Assign a category to this transaction so you'll know what you spent your money on.";
const rowOf = (page: Page, payee: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: payee });
const icon = (page: Page, payee: string) =>
  rowOf(page, payee).getByRole("button", { name: NEEDS_APPROVAL, exact: true });
const banner = (page: Page) => page.getByRole("region", { name: "New transactions", exact: true });
const menu = (page: Page) => page.getByRole("menu", { name: "Approval", exact: true });
const item = (page: Page, name: string) => menu(page).getByRole("menuitem", { name, exact: true });
const weight = (page: Page, payee: string) =>
  rowOf(page, payee)
    .locator("td[data-field=payee]")
    .evaluate((el) => getComputedStyle(el).fontWeight);
const apiRows = async (request: Parameters<typeof call>[0], plan: string, account: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}/transactions`))
    .transactions as { id: string; approved: boolean; category_id: string | null }[];

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
]) {
  test(`column, weight, banner, menu and approve at ${size.width}x${size.height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(size);
    const s = await seedApprove(request);
    const gets: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1")) gets.push(r.url());
    });
    await page.goto(`/${s.plan}/accounts/${s.checking}`);
    await expect(banner(page)).toContainText(BANNER(3));
    expect(gets.filter((u) => u.includes("needs="))).toEqual([]);
    await expect(banner(page).getByRole("button", { name: "View", exact: true })).toBeVisible();
    // Above the account header, full width.
    const bb = await banner(page).boundingBox();
    const hb = await page.getByRole("heading", { name: "ZZ Checking" }).first().boundingBox();
    expect(bb && hb && bb.y < hb.y).toBe(true);
    expect(bb?.width).toBeGreaterThan(size.width - 300);

    // Column and weight.
    await expect(page.getByRole("columnheader", { name: "Approval", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: NEEDS_APPROVAL, exact: true })).toHaveCount(3);
    await expect(icon(page, "ZZ Ok One")).toHaveCount(0);
    expect(await weight(page, "ZZ New One")).toBe("600");
    expect(await weight(page, "ZZ Ok One")).toBe("500");

    // The pill and the tooltips.
    const pill = rowOf(page, "ZZ New Bare").getByRole("button", {
      name: "This needs a category",
      exact: true,
    });
    await expect(pill).toHaveAttribute("title", TIP);
    const css = await pill.evaluate((el) => {
      const c = getComputedStyle(el);
      return [
        c.backgroundColor,
        c.color,
        c.fontSize,
        c.fontWeight,
        c.paddingLeft,
        c.paddingRight,
        Number.parseFloat(c.borderTopLeftRadius) >= el.getBoundingClientRect().height / 2,
      ];
    });
    expect(css).toEqual(["rgb(218, 172, 0)", "rgb(54, 44, 5)", "14px", "600", "8px", "8px", true]);
    await expect(rowOf(page, "ZZ New One").locator("td[data-field=category]")).toHaveAttribute(
      "title",
      "ZZ Group: ZZ Food",
    );

    // The menu: the row is not selected; Escape closes it and focus returns; a click outside closes it.
    await realClick(page, icon(page, "ZZ New One"));
    await expect(menu(page)).toBeVisible();
    await expect(item(page, "Approve Transaction")).toBeVisible();
    await expect(item(page, "Reject Transaction")).toBeVisible();
    await expect(rowOf(page, "ZZ New One")).not.toHaveClass(/is-checked/);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(icon(page, "ZZ New One")).toBeFocused();
    await realClick(page, icon(page, "ZZ New One"));
    await realClick(page, page.getByRole("heading", { name: "ZZ Checking" }).first());
    await expect(menu(page)).toHaveCount(0);

    // Reject is disabled on a row that was not imported.
    await realClick(page, icon(page, "ZZ New One"));
    await expect(item(page, "Reject Transaction")).toHaveAttribute("aria-disabled", "true");
    await expect(item(page, "Reject Transaction")).toHaveAttribute(
      "title",
      "Only an imported transaction can be rejected",
    );

    // Approve: exactly one request with that id; the icon goes, the row is 500, the banner reads 2.
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/transactions/approve")) {
        posts.push(r.postData() ?? "");
      }
    });
    await realClick(page, item(page, "Approve Transaction"));
    await expect(icon(page, "ZZ New One")).toHaveCount(0);
    expect(await weight(page, "ZZ New One")).toBe("500");
    await expect(banner(page)).toContainText(BANNER(2));
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0] ?? "{}").ids).toEqual([s.unapproved[0]]);
    await expect
      .poll(
        async () =>
          (await apiRows(request, s.plan, s.checking)).find((t) => t.id === s.unapproved[0])
            ?.approved,
      )
      .toBe(true);
  });
}

test("the pill saves a category and approves, and the banner follows without a reload", async ({
  page,
  request,
}) => {
  const s = await seedApprove(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(banner(page)).toContainText(BANNER(3));
  await realClick(
    page,
    rowOf(page, "ZZ New Bare").getByRole("button", { name: "This needs a category", exact: true }),
  );
  await page.getByRole("combobox", { name: "Category", exact: true }).fill("ZZ Food");
  await realClick(page, page.getByRole("option", { name: /ZZ Food/ }).first());
  await page.keyboard.press("Enter");
  await expect
    .poll(async () =>
      (await apiRows(request, s.plan, s.checking)).find((t) => t.id === s.unapproved[2]),
    )
    .toMatchObject({ approved: true, category_id: s.food });
  await expect(banner(page)).toContainText(BANNER(2));
  await expect(icon(page, "ZZ New Bare")).toHaveCount(0);
});

test("reject: one request, the row goes, a refusal stays in the menu", async ({
  page,
  request,
}) => {
  const s = await seedApprove(request);
  const posted = await stubReject(page, request, s.plan, s.unapproved, "409");
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await realClick(page, icon(page, "ZZ New Two"));
  await realClick(page, item(page, "Reject Transaction"));
  await expect(page.getByRole("alert").filter({ hasText: /rejected|approved/i })).toBeVisible();
  await expect(menu(page)).toBeVisible();
  await expect(rowOf(page, "ZZ New Two")).toHaveCount(1);
  await page.keyboard.press("Escape");

  const page2 = await page.context().newPage();
  const posted2 = await stubReject(page2, request, s.plan, s.unapproved, "delete");
  await page2.goto(`/${s.plan}/accounts/${s.checking}`);
  await realClick(page2, icon(page2, "ZZ New Two"));
  await realClick(page2, item(page2, "Reject Transaction"));
  await expect(rowOf(page2, "ZZ New Two")).toHaveCount(0);
  await expect(banner(page2)).toContainText(BANNER(2));
  expect(posted2).toEqual([{ ids: [s.unapproved[1]] }]);
  expect(posted).toHaveLength(1);
});

test("the banner: singular, none, and All Accounts counts open accounts", async ({
  page,
  request,
}) => {
  const s = await seedApprove(request, { savingsUnapproved: true });
  await page.goto(`/${s.plan}/accounts`);
  await expect(banner(page)).toContainText(BANNER(4));
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions/approve`, {
    ids: [s.unapproved[0], s.unapproved[1], s.savingsRow],
  });
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(banner(page)).toContainText(BANNER(1));
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/transactions/${s.unapproved[2]}`, {
    category_id: s.food,
  });
  await page.reload();
  await expect(page.getByRole("table", { name: "ZZ Checking transactions" })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("View lists every row that needs attention whatever View options hide, and the chip ends it", async ({
  page,
  request,
}) => {
  const s = await seedApprove(request, { old: true, reconciledUnapproved: true });
  const stored = await setViewSettings(request, s.plan, s.checking, {
    preset: "this_month",
    show_reconciled: false,
  });
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const n = (await call(request, "GET", `/api/v1/budgets/${s.plan}/accounts/${s.checking}`)).account
    .needs_attention_count as number;
  expect(n).toBe(5); // three seeded, the old one and the reconciled one
  await expect(banner(page)).toContainText(BANNER(n));
  await expect(rowOf(page, "ZZ Old New")).toHaveCount(0);
  await realClick(page, banner(page).getByRole("button", { name: "View", exact: true }));
  const chip = page.getByRole("button", {
    name: "Remove filter: Unapproved or Uncategorized",
    exact: true,
  });
  await expect(chip).toBeVisible();
  await expect(page.locator(".register-table tbody tr[data-tx]")).toHaveCount(n);
  await expect(rowOf(page, "ZZ Old New")).toHaveCount(1);
  await expect(rowOf(page, "ZZ Rec New")).toHaveCount(1);
  await expect(rowOf(page, "ZZ Ok One")).toHaveCount(0);
  await expect(page.getByText("Some transactions are hidden by filters.")).toHaveCount(0);
  expect(await viewSettingsOf(request, s.plan, s.checking)).toEqual(stored);
  await realClick(page, chip);
  await expect(chip).toHaveCount(0);
  await expect(rowOf(page, "ZZ Old New")).toHaveCount(0);
  await realClick(page, banner(page).getByRole("button", { name: "View", exact: true }));
  await page.reload();
  await expect(page.getByRole("table", { name: "ZZ Checking transactions" })).toBeVisible();
  await expect(chip).toHaveCount(0);
});

test("bulk Approve of three ticked rows, and a closed account still shows its banner", async ({
  page,
  request,
}) => {
  const s = await seedApprove(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  for (const p of ["ZZ New One", "ZZ New Two", "ZZ New Bare"]) {
    await realClick(
      page,
      rowOf(page, p).getByRole("checkbox", { name: "Select transaction", exact: true }),
    );
  }
  const bar = page.getByRole("toolbar", { name: "Selection actions" });
  await realClick(page, bar.getByRole("button", { name: "Approve", exact: true }));
  await expect
    .poll(
      async () => (await apiRows(request, s.plan, s.checking)).filter((t) => !t.approved).length,
    )
    .toBe(0);
  await expect(page.getByRole("button", { name: NEEDS_APPROVAL, exact: true })).toHaveCount(0);
  // Still uncategorized: the banner keeps one.
  await expect(banner(page)).toContainText(BANNER(1));
  await call(request, "POST", `/api/v1/budgets/${s.plan}/accounts/${s.checking}/close`, {});
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(banner(page)).toContainText(BANNER(1));
});

test("the attention column and the banner are absent when no row needs approval", async ({
  page,
  request,
}) => {
  const s = await seedApprove(request);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions/approve`, {
    ids: s.unapproved,
  });
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/transactions/${s.unapproved[2]}`, {
    category_id: s.food,
  });
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Ok One")).toBeVisible();
  // Source: the column is display:none with no unapproved row (Designer polish P1).
  await expect(page.getByRole("columnheader", { name: "Approval", exact: true })).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);
});

test("the banner is one click target and the approval menu is 320px, clear of the sidebar", async ({
  page,
  request,
}) => {
  const s = await seedApprove(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  // Source (Designer polish P6, P7, dark): banner 48px high, #292c6c; View 32px; the menu panel 320px wide.
  const b = await banner(page).boundingBox();
  expect(Math.round(b?.height ?? 0)).toBe(48);
  expect(await banner(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(41, 44, 108)",
  );
  await realClick(page, icon(page, "ZZ New One"));
  const m = await menu(page).boundingBox();
  expect(Math.round(m?.width ?? 0)).toBe(320);
  const side = await page.getByRole("navigation", { name: "Sidebar" }).boundingBox();
  expect((m?.x ?? 0) >= (side?.x ?? 0) + (side?.width ?? 0)).toBe(true);
  await page.keyboard.press("Escape");
  await realClick(page, banner(page));
  await expect(page.getByRole("button", { name: /Remove filter/ })).toBeVisible();
});
