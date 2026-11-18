import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { openManagePayees } from "./support/manage-payees-seed";
import { call, TODAY } from "./support/register-seed";

const COUNT = 2000;

test("18 2,000 payees: the dialog opens, scrolls and filters without a visible wait", async ({
  page,
  request,
}) => {
  // Seeding 2,000 payees takes 2,000 requests (ten at a time): this one test needs more than the default 30 s.
  test.setTimeout(240_000);
  const name = testName("scale");
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name });
  const plan = budget.id as string;
  await call(request, "PATCH", `/api/v1/budgets/${plan}`, { opened: true });
  const acct = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ Checking",
      type: "checking",
      balance: 0,
      date: TODAY,
    })
  ).account.id as string;
  for (let i = 0; i < COUNT; i += 10) {
    await Promise.all(
      Array.from({ length: 10 }, (_, j) =>
        call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
          account_id: acct,
          date: TODAY,
          amount: -1,
          payee_name: `ZZ Scale ${String(i + j).padStart(4, "0")}`,
        }),
      ),
    );
  }
  // The Plan page: the register behind the dialog would load 2,000 rows and busy the page.
  await page.goto(`/${plan}/budget`);
  const t0 = Date.now();
  const d = await openManagePayees(page, name);
  await expect(d.locator(".mp-name").first()).toHaveText("ZZ Scale 0000");
  const open = Date.now() - t0;
  // Few rows are in the page whatever the list's length.
  expect(await d.locator(".mp-row").count()).toBeLessThan(80);
  const list = d.getByRole("listbox", { name: "Payees", exact: true });
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(d.getByRole("button", { name: "Select ZZ Scale 1999", exact: true })).toBeVisible();
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  const search = d.getByRole("textbox", { name: "Search Payees", exact: true });
  const t1 = Date.now();
  await search.fill("1999");
  await expect(d.locator(".mp-name").first()).toHaveText("ZZ Scale 1999");
  const filter = Date.now() - t1;
  console.log(`manage-payees-scale open=${open}ms filter=${filter}ms`);
  // The design's budgets: menu click to first row, and typed text to the filtered list.
  expect(open).toBeLessThanOrEqual(1500);
  expect(filter).toBeLessThanOrEqual(300);
});
