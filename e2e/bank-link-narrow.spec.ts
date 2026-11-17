import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { newAccount, newPlan, openFromHeader } from "./support/account-edit-seed";
import { fakeBankAccount, fakeConnection, stubBankLink } from "./support/bank-link-stub";
import { stubPlaidLink } from "./support/plaid-stub";
import { realClick } from "./support/real-click";

test.use({ viewport: { width: 1024, height: 700 } });

const LONG = (n: number) => `ZZ ${String(n).padStart(2, "0")} ${"long name ".repeat(8)}`.trim();
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });

/** Twelve bank accounts with long names, so every list is longer than the room. */
function crowdedBank() {
  const accounts = Array.from({ length: 12 }, (_, i) =>
    fakeBankAccount({ name: LONG(i), mask: `${1000 + i}`, current_balance: 100000 + i }),
  );
  return { accounts, connection: fakeConnection({ nickname: LONG(99), accounts }) };
}

async function inWindow(page: Page, box: Locator) {
  const b = await box.boundingBox();
  expect(b).not.toBeNull();
  const v = page.viewportSize() as { width: number; height: number };
  expect(b?.x).toBeGreaterThanOrEqual(0);
  expect(b?.y).toBeGreaterThanOrEqual(0);
  expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(v.width);
  expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(v.height);
}

/** Every cut text of `selector` inside `scope` ends in an ellipsis and holds its whole text in `title`. */
async function cutTextsHaveTitles(scope: Locator, selector: string) {
  const bad = await scope.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => el.scrollWidth > el.clientWidth)
      .filter(
        (el) =>
          getComputedStyle(el).textOverflow !== "ellipsis" ||
          el.getAttribute("title") !== el.textContent,
      )
      .map((el) => el.textContent),
  );
  expect(bad).toEqual([]);
}
const cutCount = (scope: Locator, selector: string) =>
  scope
    .locator(selector)
    .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).length);

async function scrollsInside(body: Locator) {
  expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
}

test("16 Add Accounts, Account Details and the summary at 1024×700", async ({ page, request }) => {
  const budget = await newPlan(request);
  const { connection } = crowdedBank();
  await stubBankLink(page, request, {
    budgetId: budget,
    connections: [],
    newConnection: connection,
  });
  await stubPlaidLink(page, {
    success: {
      public_token: "public-test-token",
      institution: { name: "ZZ Bank", institution_id: "ins_test_1" },
    },
  });
  await page.goto(`/${budget}/budget`);
  await page.getByRole("button", { name: "Add Account" }).click();
  const dialog = page.locator(".account-modal");
  await dialog.getByRole("button", { name: "ZZ Test Bank 1" }).click();
  await expect(dialog.locator(".bank-link-row")).toHaveCount(12);

  await inWindow(page, dialog);
  await scrollsInside(dialog.locator(".account-modal-body"));
  await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
  expect(await cutCount(dialog, ".bank-link-name")).toBeGreaterThan(0);
  await cutTextsHaveTitles(dialog, ".bank-link-name, .bank-link-sub");

  await realClick(page, dialog.getByRole("button", { name: /^Edit ZZ 00/ }));
  await expect(dialog.getByRole("heading", { name: "Account Details" })).toBeVisible();
  await inWindow(page, dialog);
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
  await realClick(page, dialog.getByRole("button", { name: "Save", exact: true }));

  await realClick(page, dialog.getByRole("button", { name: "Next", exact: true }));
  await expect(dialog.getByRole("button", { name: "Add 12 Accounts", exact: true })).toBeVisible();
  await inWindow(page, dialog);
  await scrollsInside(dialog.locator(".account-modal-body"));
  await expect(
    dialog.getByRole("button", { name: "Add 12 Accounts", exact: true }),
  ).toBeInViewport();
  await cutTextsHaveTitles(dialog, ".bank-link-name, .bank-link-sub");
});

async function linkedPlan(page: Page, request: APIRequestContext, unlinked: boolean) {
  const budget = await newPlan(request);
  const name = `ZZ ${"very long account name ".repeat(4)}`.trim();
  const id = await newAccount(request, budget, name, "checking", 5000);
  const { accounts, connection } = crowdedBank();
  const stub = await stubBankLink(page, request, {
    budgetId: budget,
    connections: [
      { ...connection, last_synced_at: new Date(Date.now() - 3_600_000).toISOString() },
    ],
    links: unlinked ? {} : { [id]: (accounts[0] as { id: string }).id },
    unapproved: unlinked ? {} : { [id]: 3 },
  });
  void stub;
  await page.goto(`/${budget}/accounts/${id}`);
  return { budget, id, name };
}

test("16 Link Account at 1024×700 scrolls inside the dialog", async ({ page, request }) => {
  await linkedPlan(page, request, true);
  await openFromHeader(page);
  await realClick(
    page,
    page
      .getByRole("dialog", { name: "Edit Account" })
      .getByRole("button", { name: "Link Account", exact: true }),
  );
  const link = page.getByRole("dialog", { name: "Link Account" });
  await expect(link.locator(".link-account-row")).toHaveCount(13);
  await inWindow(page, link);
  await scrollsInside(link.locator(".account-modal-body"));
  await cutTextsHaveTitles(link, ".bank-link-name, .bank-link-sub, h3");
});

test("16 Edit Account (linked), Unlink and the sidebar row at 1024×700", async ({
  page,
  request,
}) => {
  const { name } = await linkedPlan(page, request, false);
  const row = sidebar(page).locator(".nav-account-row").filter({ hasText: "ZZ very long" });
  await expect(row.locator(".nav-link-status")).toBeVisible();
  await expect(row.locator(".nav-unapproved-dot")).toBeVisible();
  const r = await row.boundingBox();
  for (const part of [".name", ".value", ".nav-link-status", ".nav-unapproved-dot"]) {
    const b = await row.locator(part).boundingBox();
    expect(b?.x).toBeGreaterThanOrEqual((r?.x ?? 0) - 0.5);
    expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual((r?.x ?? 0) + (r?.width ?? 0) + 0.5);
  }
  expect(await row.locator(".name").evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await expect(row.locator(".name")).toHaveAttribute("title", name);
  await cutTextsHaveTitles(sidebar(page), ".name");

  await openFromHeader(page);
  const edit = page.getByRole("dialog", { name: "Edit Account" });
  await inWindow(page, edit);
  await expect(edit.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
  await realClick(page, edit.getByRole("button", { name: "Unlink Account", exact: true }));
  const confirm = page.getByRole("dialog", { name: "Unlink Account" });
  await inWindow(page, confirm);
  await expect(
    confirm.getByRole("button", { name: "Unlink Account", exact: true }),
  ).toBeInViewport();
});
