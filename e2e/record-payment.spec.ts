import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { CLOCK, fixCardClock, NOV, payCard, paymentAvailable, seedCard } from "./support/card-seed";
import { call, realClick } from "./support/register-seed";

// EXF-539. The source's test plan has no credit card: everything here is built from the ticket's text and is
// "not compared" with the source.

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const payee = (page: Page) => page.getByRole("combobox", { name: "Payee", exact: true });
const category = (page: Page) => page.getByRole("combobox", { name: "Category", exact: true });
const inflow = (page: Page) => page.getByRole("textbox", { name: "Inflow", exact: true });
const date = (page: Page) => page.getByRole("textbox", { name: "Date", exact: true });
const pill = (page: Page) => page.locator("[data-balance=payment] .acct-payment-pill");
const working = (page: Page) => page.locator("[data-balance=working] .acct-amount");
const realRow = (page: Page, text: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: text });
const rows = async (request: Parameters<typeof call>[0], plan: string, account: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}/transactions`))
    .transactions as {
    id: string;
    amount: number;
    category_id: string | null;
    transfer_account_id: string | null;
    payee_name: string | null;
    date: string;
  }[];

async function open(page: Page, plan: string, account: string, query = "") {
  await fixCardClock(page);
  await page.goto(`/${plan}/accounts/${account}${query}`);
  await expect(button(page, "Add Transaction")).toBeVisible();
}

test("the card header: badge, three balances and the Payment pill; a line of credit too, a checking account not (539 AC1)", async ({
  page,
  request,
}) => {
  const s = await seedCard(request, { loc: true });
  await open(page, s.plan, s.visa);
  await expect(page.locator(".acct-info")).toContainText("Credit Card");
  await expect(page.locator(".acct-balance[data-balance=cleared]")).toBeVisible();
  await expect(working(page)).toHaveText("-$335.00");
  await expect(pill(page)).toHaveText("$335.00");
  await expect(pill(page)).toHaveClass(/is-positive/);
  await expect(page.locator("[data-balance=payment] .acct-label")).toHaveText("Payment");

  await payCard(request, s.plan, s.visa, s.checking, 335000);
  await page.reload();
  await expect(pill(page)).toHaveText("$0.00");
  await expect(pill(page)).toHaveClass(/is-zero/);

  await payCard(request, s.plan, s.visa, s.checking, 50000);
  await page.reload();
  // Source (measured live): the negative pill reads with U+2212 and a leading exclamation icon.
  await expect(pill(page)).toHaveText("\u2212$50.00");
  await expect(pill(page)).toHaveClass(/is-negative/);

  await open(page, s.plan, s.loc as string);
  await expect(page.locator("[data-balance=payment]")).toHaveCount(1);
  await open(page, s.plan, s.checking);
  await expect(page.locator("[data-balance=payment]")).toHaveCount(0);
});

test("the toolbar: Record Payment on a card only; the new row is dated today with Inflow prefilled (539 AC2)", async ({
  page,
  request,
}) => {
  const s = await seedCard(request);
  await open(page, s.plan, s.visa);
  const names = await page
    .getByRole("toolbar", { name: "Register toolbar" })
    .getByRole("button")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent?.trim()));
  expect(names.slice(0, 5)).toEqual([
    "Add Transaction",
    "File Import",
    "Record Payment",
    "Undo",
    "Redo",
  ]);
  await expect(button(page, "Record Payment")).toBeEnabled();
  await realClick(page, button(page, "Record Payment"));
  // Source (polish P5): the new payment row focuses Date, like Add Transaction; payee stays empty.
  await expect(date(page)).toBeFocused();
  await expect(payee(page)).toHaveValue("");
  await expect(date(page)).toHaveValue("11/16/2026");
  await expect(inflow(page)).toHaveValue("335.00");
  await expect(category(page)).toHaveValue("");

  await open(page, s.plan, s.checking);
  await expect(button(page, "Record Payment")).toHaveCount(0);

  // Nothing to pay: Inflow stays empty.
  await payCard(request, s.plan, s.visa, s.checking, 335000);
  await open(page, s.plan, s.visa);
  await expect(pill(page)).toHaveText("$0.00");
  await realClick(page, button(page, "Record Payment"));
  await expect(inflow(page)).toHaveValue("");
});

test("Payment from, the fixed category, saving, and both sides' display (539 AC3, AC4 figures)", async ({
  page,
  request,
}) => {
  const s = await seedCard(request);
  await open(page, s.plan, s.visa);
  // The button stays disabled until the card's payment figure has settled: wait for it, as case 539 AC2 does.
  await expect(button(page, "Record Payment")).toBeEnabled();
  await realClick(page, button(page, "Record Payment"));
  await payee(page).fill("");
  await payee(page).click();
  const list = page.getByRole("listbox", { name: "Payees", exact: true });
  await expect(
    list.getByRole("option", { name: "Payment from ZZ-TEST Checking", exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("option", { name: "Payment from ZZ-TEST Savings", exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("option", { name: "To/From ZZ-TEST Asset", exact: true }),
  ).toBeVisible();
  await realClick(
    page,
    list.getByRole("option", { name: "Payment from ZZ-TEST Checking", exact: true }),
  );
  await expect(category(page)).toHaveValue("Credit Card Payments: ZZ-TEST Visa");
  // Source (polish P6): the field looks like an enabled one; here it is read-only, with no list (design D4).
  await expect(category(page)).toHaveAttribute("readonly", "");
  await expect(category(page)).toBeEnabled();
  await inflow(page).fill("200.00");
  await realClick(page, button(page, "Save"));
  await expect
    .poll(async () => (await rows(request, s.plan, s.visa)).some((r) => r.amount === 200000))
    .toBe(true);
  const stored = (await rows(request, s.plan, s.visa)).find((r) => r.amount === 200000);
  expect(stored?.category_id).toBeNull();
  expect(stored?.date).toBe(CLOCK);

  const row = realRow(page, "Payment: ZZ-TEST Checking");
  await expect(row).toHaveCount(1);
  await expect(row.locator("td[data-field=category]")).toHaveText(
    "Credit Card Payments: ZZ-TEST Visa",
  );
  await expect(row.locator(".transfer-link")).toBeVisible();
  await expect(pill(page)).toHaveText("$135.00");
  await expect(working(page)).toHaveText("-$135.00");
  expect(await paymentAvailable(request, s.plan, s.visa)).toBe(135000);

  // The other side reads the same, and its payee list says To/From.
  await open(page, s.plan, s.checking);
  const other = realRow(page, "Payment: ZZ-TEST Visa");
  await expect(other).toHaveCount(1);
  await expect(other.locator("td[data-field=category]")).toHaveText(
    "Credit Card Payments: ZZ-TEST Visa",
  );
  await realClick(page, button(page, "Add Transaction"));
  await payee(page).click();
  await expect(
    page
      .getByRole("listbox", { name: "Payees", exact: true })
      .getByRole("option", { name: "To/From ZZ-TEST Visa", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // A second payment of 185.00 overpays the category.
  await open(page, s.plan, s.visa);
  // The button stays disabled until the card's payment figure has settled: wait for it, as case 539 AC2 does.
  await expect(button(page, "Record Payment")).toBeEnabled();
  await realClick(page, button(page, "Record Payment"));
  await payee(page).fill("Payment from ZZ-TEST Checking");
  await realClick(
    page,
    page
      .getByRole("listbox", { name: "Payees", exact: true })
      .getByRole("option", { name: "Payment from ZZ-TEST Checking", exact: true }),
  );
  await inflow(page).fill("185.00");
  await realClick(page, button(page, "Save"));
  // Source (measured live): the negative pill reads with U+2212 and a leading exclamation icon.
  await expect(pill(page)).toHaveText("\u2212$50.00");
  await expect(pill(page)).toHaveClass(/is-negative/);
  await expect(working(page)).toHaveText("$50.00");
});

test("a card row in its own payment category is refused and the row stays open (539 AC5)", async ({
  page,
  request,
}) => {
  const s = await seedCard(request);
  await open(page, s.plan, s.visa);
  const before = (await rows(request, s.plan, s.visa)).length;
  await realClick(page, button(page, "Add Transaction"));
  await payee(page).fill("ZZ Shop");
  await category(page).fill("ZZ-TEST Visa");
  await realClick(page, page.getByRole("option", { name: /ZZ-TEST Visa/ }).first());
  await page.getByRole("textbox", { name: "Outflow", exact: true }).fill("5.00");
  await realClick(page, button(page, "Save"));
  const alert = page.getByRole("alert").filter({ hasText: "own payment category" });
  await expect(alert).toContainText(
    "Couldn't save the transaction. A transaction on ZZ-TEST Visa can't use its own payment category.",
  );
  await expect(page.locator(".entry-body")).toHaveCount(1);
  expect((await rows(request, s.plan, s.visa)).length).toBe(before);
});

test("the Starting Balance row of a card reads Category not needed (539)", async ({
  page,
  request,
}) => {
  const s = await seedCard(request);
  await open(page, s.plan, s.visa);
  await expect(realRow(page, "Starting Balance").locator("td[data-field=category]")).toHaveText(
    "Category not needed",
  );
});

test("?record-payment opens the payment row on a card and is removed; on a checking account only removed (Lead note 2)", async ({
  page,
  request,
}) => {
  const s = await seedCard(request);
  await open(page, s.plan, s.visa, "?record-payment");
  await expect(inflow(page)).toHaveValue("335.00");
  await expect(date(page)).toHaveValue("11/16/2026");
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await page.reload();
  await expect(button(page, "Add Transaction")).toBeVisible();
  await expect(page.locator(".entry-body")).toHaveCount(0);

  await open(page, s.plan, s.checking, "?record-payment");
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await expect(page.locator(".entry-body")).toHaveCount(0);

  // All Accounts has no card: the parameter is dropped there too.
  await fixCardClock(page);
  await page.goto(`/${s.plan}/accounts?record-payment`);
  await expect(button(page, "Add Transaction")).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await expect(page.locator(".entry-body")).toHaveCount(0);
});

const within = (box: Locator, inner: Locator) =>
  Promise.all([box.boundingBox(), inner.boundingBox()]).then(([b, i]) => {
    expect(b && i).toBeTruthy();
    return (i?.x ?? 0) + (i?.width ?? 0) <= (b?.x ?? 0) + (b?.width ?? 0) + 0.5;
  });

test("1024x700: a long card name, balances near -12,345.67 and two rows ticked fit (539 AC21)", async ({
  page,
  request,
}) => {
  const s = await seedCard(request, {
    visaName: "ZZ-TEST Visa Signature Rewards",
    spent: 12345670,
  });
  // Paying twice what was spent leaves the pill at -$12,345.67 (the widest figure: a sign and five digits).
  await payCard(request, s.plan, s.visa, s.checking, 12345670);
  await payCard(request, s.plan, s.visa, s.checking, 12345670);
  await page.setViewportSize({ width: 1024, height: 700 });
  await open(page, s.plan, s.visa);
  await expect(pill(page)).toHaveText("\u2212$12,345.67");
  const boxes = page.locator(".register-table tbody tr[data-tx]");
  await realClick(
    page,
    boxes.nth(0).getByRole("checkbox", { name: "Select transaction", exact: true }),
  );
  await realClick(
    page,
    boxes.nth(1).getByRole("checkbox", { name: "Select transaction", exact: true }),
  );
  await expect(page.locator("[data-balance=selected]")).toBeVisible();
  const strip = page.locator(".acct-balances");
  for (const sel of [
    "[data-balance=cleared]",
    "[data-balance=uncleared]",
    "[data-balance=working]",
    "[data-balance=selected]",
    "[data-balance=payment]",
  ]) {
    const b = page.locator(sel);
    expect(await b.evaluate((e) => e.scrollWidth <= e.clientWidth), sel).toBe(true);
    expect(await within(strip, b), `${sel} inside the strip`).toBe(true);
    for (const part of await b.locator(".acct-amount, .acct-label, .acct-payment-pill").all()) {
      const h = await part.evaluate((e) => {
        const lh = Number.parseFloat(getComputedStyle(e).lineHeight);
        return e.getBoundingClientRect().height <= lh * 1.5 + 8;
      });
      expect(h, `${sel} text on one line`).toBe(true);
    }
  }
  const toolbar = page.locator(".register-toolbar");
  for (const b of await toolbar.getByRole("button").all()) {
    expect(await within(toolbar, b)).toBe(true);
  }
  // Source (polish P7): at this width Record Payment, Undo and Redo sit in the More button; the search stays 192px.
  await expect(button(page, "Record Payment")).toHaveCount(0);
  await expect(button(page, "File Import")).toBeVisible();
  expect(
    await page.locator(".search-box input").evaluate((e) => e.getBoundingClientRect().width),
  ).toBe(192);
  await realClick(page, toolbar.getByRole("button", { name: "More", exact: true }));
  await expect(
    page
      .getByRole("menu", { name: "More toolbar actions" })
      .getByRole("button", { name: "Record Payment" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  for (const label of await toolbar.locator(".toolbar-label:visible").all()) {
    expect(await label.evaluate((e) => e.getBoundingClientRect().height <= 24)).toBe(true);
  }
  await page.screenshot({ path: ".screenshots/card-payments-1024.png" });
});

test("the card page reads one month and nothing per row (539 D1 calls)", async ({
  page,
  request,
}) => {
  const s = await seedCard(request, { visa2: true });
  let months = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === `/api/v1/budgets/${s.plan}/months/${NOV}`) months += 1;
  });
  await open(page, s.plan, s.visa);
  await expect(pill(page)).toHaveText("$335.00");
  expect(months).toBeLessThanOrEqual(1);
});
