import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  badAmountPair,
  chooseFiles,
  importForms,
  importRequests,
  openImport,
  recordImportForms,
  symbolPair,
  unclearZip,
} from "./support/plan-import-dialog-files";
import { realClick } from "./support/real-click";

test.use({ viewport: { width: 1440, height: 900 } });

const dialog = (page: Page) => page.getByRole("dialog", { name: "Import Plan", exact: true });

test("8 preview edits and the date question; every request before Import is a dry run", async ({
  page,
}) => {
  const requests = importRequests(page);
  await recordImportForms(page);
  await openImport(page);
  await chooseFiles(page, [unclearZip()]);
  const d = dialog(page);
  const importButton = d.getByRole("button", { name: "Import", exact: true });
  await expect(d.getByRole("group", { name: /The date format of .* is unclear/ })).toBeVisible();
  await expect(d.getByRole("radio")).toHaveCount(2);
  await expect(importButton).toBeDisabled();
  await expect(d.getByRole("heading", { name: "Warnings", exact: true })).toBeVisible();
  await expect(d.getByText(/flag "Tax"|Tax/).first()).toBeVisible();
  const mismatch = d.getByRole("heading", { name: "Mismatches", exact: true });
  await expect(mismatch).toBeVisible();
  await expect(d.getByText(/Oct 2026 · Activity · expected .* · got /)).toBeVisible();

  // An answer: a dry run with date_format; Import is enabled.
  const before = requests.length;
  await d.getByRole("radio", { name: /October 5, 2026/ }).check();
  await expect(importButton).toBeEnabled();
  expect(requests.length).toBe(before + 1);
  expect((await importForms(page))[before]?.date_format).toBe("MM/DD/YYYY");
  await expect(d.getByRole("radio", { name: /October 5, 2026/ })).toBeChecked();

  // An account's type: a dry run with account_types.
  await d.getByLabel("Type of Edge Checking", { exact: true }).selectOption("savings");
  await expect.poll(() => requests.length).toBe(before + 2);
  expect(JSON.parse((await importForms(page))[before + 1]?.account_types ?? "{}")).toEqual({
    "Edge Checking": "savings",
  });
  await expect(d.getByLabel("Type of Edge Checking", { exact: true })).toHaveValue("savings");

  // The decimal separator: a dry run with currency_format.
  await d.getByLabel("Decimal separator", { exact: true }).selectOption(",");
  await expect.poll(() => requests.length).toBe(before + 3);
  expect(JSON.parse((await importForms(page))[before + 2]?.currency_format ?? "{}")).toMatchObject({
    decimal_separator: ",",
  });

  expect(requests.length).toBeGreaterThan(0);
  for (const r of requests) {
    expect(r.method).toBe("POST");
    expect(r.url).toContain("dry_run=true");
  }
});

test("9 a file that cannot be read: the server's words, no content in the console", async ({
  page,
}) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => logs.push(String(e)));
  const requests = importRequests(page);
  await openImport(page);
  await chooseFiles(page, badAmountPair());
  const alert = dialog(page).getByRole("alert");
  await expect(alert).toContainText("This file cannot be imported: Register file line 3");
  await expect(alert).toContainText("is not an amount");
  await expect(dialog(page).getByRole("button", { name: /Drop the files here/ })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toContain("dry_run=true");
  await realClick(page, dialog(page).getByRole("button", { name: "Cancel", exact: true }));
  await expect(dialog(page)).toHaveCount(0);
  expect(logs.filter((l) => l.includes("1,23.45") || l.includes("Bad Checking"))).toEqual([]);
});

test("15 a symbol the app does not know: the person chooses the plan's currency, and the import sends it", async ({
  page,
}) => {
  const requests = importRequests(page);
  await recordImportForms(page);
  await openImport(page);
  await chooseFiles(page, symbolPair("Ƶ"));
  const d = dialog(page);
  const choice = d.getByLabel("Plan currency", { exact: true });
  await expect(choice).toBeVisible();
  await expect(d.getByText(/does not name one currency/)).toBeVisible();
  // The detected currency (what the app would have stored) comes first.
  await expect(choice.locator("option").first()).toHaveAttribute("value", "USD");
  const before = requests.length;
  await choice.selectOption("EUR");
  await expect.poll(() => requests.length).toBe(before + 1);
  expect(JSON.parse((await importForms(page))[before]?.currency_format ?? "{}")).toMatchObject({
    iso_code: "EUR",
  });
  await expect(choice).toHaveValue("EUR");
  await expect(d.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
});

test("15b a plain '$' file: USD is chosen without a select, and Change reveals the select", async ({
  page,
}) => {
  const requests = importRequests(page);
  await recordImportForms(page);
  await openImport(page);
  await chooseFiles(page, symbolPair("$"));
  const d = dialog(page);
  const block = d.locator(".plan-import-dialog-currency");
  await expect(block).toContainText("USD");
  await expect(d.getByLabel("Plan currency", { exact: true })).toHaveCount(0);
  await block.getByRole("button", { name: "Change", exact: true }).click();
  const choice = d.getByLabel("Plan currency", { exact: true });
  await expect(choice).toHaveValue("USD");
  const before = requests.length;
  await choice.selectOption("CAD");
  await expect.poll(() => requests.length).toBe(before + 1);
  expect(JSON.parse((await importForms(page))[before]?.currency_format ?? "{}")).toMatchObject({
    iso_code: "CAD",
  });
  await expect(choice).toHaveValue("CAD");
});
