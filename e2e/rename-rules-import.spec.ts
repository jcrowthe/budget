import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { importViaApi, seedFileImport } from "./support/file-import-seed";
import { payeeIds } from "./support/manage-payees-seed";
import { realClick } from "./support/real-click";
import { call, TODAY } from "./support/register-seed";
import { rulesOf } from "./support/rename-rules-seed";
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
  // The renamed row's text is the register's tooltip (test 5b); only the plain row keeps a `title`.
  await expect(row(page, "ZZ Cafe").locator(".import-payee-name")).not.toHaveAttribute(
    "title",
    /.*/,
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

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "file-import");
const csv = (name: string) => ({ name, buffer: readFileSync(path.join(FIX, name)) });

test("4 a matched row still holds the bank's texts: Bank Import Details shows, without Don't rename as", async ({
  page,
  request,
}) => {
  // The worked seed has a hand-entered `Corner Market` that three-rows.csv's `Sample Corner Market` row matches.
  const s = await seedFileImport(request, { kind: "worked" });
  await importViaApi(request, s.plan, s.checking, csv("three-rows.csv"), TODAY);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const matched = row(page, "Corner Market");
  await expect(matched).toHaveCount(1);
  await matched.locator(".import-payee-name").hover();
  await realClick(page, info(page, "Corner Market"));
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByText("As we imported it", { exact: true })).toBeVisible();
  await expect(d.getByText("Sample Corner Market", { exact: true })).toBeVisible();
  // The hand-entered payee was kept, not renamed by a rule: nothing to undo.
  await expect(d.getByRole("button", { name: /Don't rename as/ })).toHaveCount(0);
  // A hand row that was never matched has no button.
  await page.keyboard.press("Escape");
  await expect(info(page, "ZZ Rent")).toHaveCount(0);
});

test("5b the payee tooltip is the register's tooltip component, not the browser's title", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await stubRenameRulesImports(page, dress(s));
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  const name = row(page, "ZZ Cafe").locator(".import-payee-name");
  await expect(name).not.toHaveAttribute("title", /.*/);
  await name.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toHaveText("ZZ Cafe (Imported as ZZ BANK CAFE 12)");
  await expect(tip).toHaveClass(/acct-tooltip/);
  // No clipping ancestor (the cell used to) cuts it off: every one that clips still contains its box.
  expect(
    await tip.evaluate((el) => {
      const t = el.getBoundingClientRect();
      for (let a = el.parentElement; a; a = a.parentElement) {
        if (getComputedStyle(a).overflow === "visible") continue;
        const r = a.getBoundingClientRect();
        if (t.bottom > r.bottom + 0.5 || t.right > r.right + 0.5) return false;
      }
      return true;
    }),
  ).toBe(true);
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);
  // A row whose payee is the imported name has no tooltip to show.
  await row(page, "ZZ Plain").locator(".import-payee-name").hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("5c Don't rename as on a really file-imported row", async ({ page, request }) => {
  const s = await seedFileImport(request);
  await importViaApi(request, s.plan, s.checking, csv("sample.csv"), TODAY);
  const list = async () =>
    (await call(request, "GET", `/api/v1/budgets/${s.plan}/accounts/${s.checking}/transactions`))
      .transactions as { id: string; payee_name: string; import_payee_name: string | null }[];
  const imported = (await list()).find((t) => t.payee_name === "Sample Cafe");
  expect(imported?.import_payee_name).toBe("Sample Cafe");
  // The owner corrects the payee: the Worker makes the rule `is Sample Cafe` for the new payee.
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/transactions/${imported?.id}`, {
    payee_name: "ZZ Corrected",
  });
  const ids = await payeeIds(request, s.plan);
  expect(
    (await rulesOf(request, s.plan, ids["ZZ Corrected"] as string)).map((r) => r.text),
  ).toEqual(["Sample Cafe"]);

  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const r = row(page, "ZZ Corrected");
  await expect(r.locator(".import-payee-name")).toBeVisible();
  await r.locator(".import-payee-name").hover();
  await realClick(page, info(page, "ZZ Corrected"));
  await realClick(
    page,
    dialog(page).getByRole("button", { name: "Don't rename as ZZ Corrected", exact: true }),
  );
  await expect(dialog(page)).toHaveCount(0);
  await expect(row(page, "Sample Cafe")).toHaveCount(1);
  expect((await list()).find((t) => t.id === imported?.id)?.payee_name).toBe("Sample Cafe");
  // The rule that renamed it is gone.
  await expect
    .poll(async () => (await rulesOf(request, s.plan, ids["ZZ Corrected"] as string)).length)
    .toBe(0);
});
