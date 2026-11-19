import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { realClick } from "./support/real-click";
import { call } from "./support/register-seed";
import { stubRenameRulesImports } from "./support/rename-rules-stub";
import { daysAgo } from "./support/view-settings";

// EXF-467: the payee cell of an imported row, its tooltip and `Bank Import Details`. Not compared with the source
// (no step of this Build opens it). The imports are stand-ins (e2e/support/rename-rules-stub.ts): real hand rows
// dressed by the list answers; the edit of `Don't rename as` goes to the real server.

const rows = (page: Page) => page.locator(".register-table tbody tr");
const row = (page: Page, payee: string) => rows(page).filter({ hasText: payee });
const info = (page: Page, payee: string) =>
  row(page, payee).getByRole("button", { name: "Bank Import Details", exact: true });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Bank Import Details", exact: true });

async function seed(request: Parameters<typeof call>[0]) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("import") });
  const plan = budget.id as string;
  const account = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ Checking",
      type: "checking",
      balance: 100000,
      date: daysAgo(30),
    })
  ).account.id as string;
  const add = async (payee: string, amount: number, days: number) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: account,
        date: daysAgo(days),
        amount,
        payee_name: payee,
      })
    ).transaction.id as string;
  const renamed = await add("ZZ Cafe", -12340, 3);
  const plain = await add("ZZ Plain", -2000, 4);
  return { plan, account, renamed, plain };
}

const dress = (s: Awaited<ReturnType<typeof seed>>) => [
  {
    id: s.renamed,
    importPayeeName: "ZZ BANK CAFE 12",
    bankDescription: "ZZ POS 4411 BANK CAFE 12",
    importedPayee: "ZZ Bank Cafe Ltd",
  },
  {
    id: s.plain,
    importPayeeName: "ZZ Plain",
    bankDescription: "ZZ PLAIN STATEMENT",
    importedPayee: "ZZ Plain",
  },
];

const payeeOf = async (request: Parameters<typeof call>[0], plan: string, id: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/transactions/${id}`)).transaction.payee_name;

test("1 the tooltip: renamed rows say what the bank sent, others the payee only", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await stubRenameRulesImports(page, dress(s));
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await expect(row(page, "ZZ Cafe")).toBeVisible();
  await expect(row(page, "ZZ Cafe").locator(".import-payee-name")).toHaveAttribute(
    "title",
    "ZZ Cafe (Imported as ZZ BANK CAFE 12)",
  );
  await expect(row(page, "ZZ Plain").locator(".import-payee-name")).toHaveAttribute(
    "title",
    "ZZ Plain",
  );
});

test("2 the info button shows on hover, opens with the mouse and by keyboard, and says both texts", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await stubRenameRulesImports(page, dress(s));
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  const button = info(page, "ZZ Cafe");
  await expect(button).toHaveCSS("opacity", "0");
  await row(page, "ZZ Cafe").locator(".import-payee-name").hover();
  await expect(button).toHaveCSS("opacity", "1");
  await realClick(page, button);
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole("heading", { name: "Bank Import Details", exact: true })).toBeVisible();
  await expect(d.getByText("As it appears on your statement", { exact: true })).toBeVisible();
  await expect(d.getByText("ZZ POS 4411 BANK CAFE 12", { exact: true })).toBeVisible();
  await expect(d.getByText("As we imported it", { exact: true })).toBeVisible();
  await expect(d.getByText("ZZ BANK CAFE 12", { exact: true })).toBeVisible();
  await expect(
    d.getByRole("button", { name: "Don't rename as ZZ Cafe", exact: true }),
  ).toBeVisible();
  // The press did not open the row for editing, and Escape closes the popover.
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);

  // By keyboard: focus the button (it shows), Enter opens it. A plain row has no link.
  await info(page, "ZZ Plain").focus();
  await expect(info(page, "ZZ Plain")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(d).toBeVisible();
  await expect(d.getByText("ZZ PLAIN STATEMENT", { exact: true })).toBeVisible();
  await expect(d.getByRole("button", { name: /Don't rename as/ })).toHaveCount(0);
  const box = await d.boundingBox();
  const vp = page.viewportSize();
  expect(box && vp && box.x >= 0 && box.x + box.width <= vp.width).toBe(true);
});

test("3 Don't rename as: the edit goes to the server with the imported name, the row and the popover follow", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await stubRenameRulesImports(page, dress(s));
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await row(page, "ZZ Cafe").locator(".import-payee-name").hover();
  await realClick(page, info(page, "ZZ Cafe"));
  const sent = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith(`/transactions/${s.renamed}`),
  );
  await realClick(
    page,
    dialog(page).getByRole("button", { name: "Don't rename as ZZ Cafe", exact: true }),
  );
  const body = (await sent).postDataJSON();
  expect(body.payee_name).toBe("ZZ BANK CAFE 12");
  expect(typeof body.approved).toBe("boolean");
  await expect.poll(() => payeeOf(request, s.plan, s.renamed)).toBe("ZZ BANK CAFE 12");
  await expect(dialog(page)).toHaveCount(0);
  await expect(info(page, "ZZ BANK CAFE 12")).toBeFocused();
  const name = row(page, "ZZ BANK CAFE 12").locator(".import-payee-name");
  await expect(name).toHaveAttribute("title", "ZZ BANK CAFE 12");
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: /Don't rename as/ })).toHaveCount(0);
});
