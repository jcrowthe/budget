import type { Page } from "@playwright/test";
import { expect as baseExpect, test } from "./fixtures";
import {
  badAmountPair,
  chooseFiles,
  importForms,
  importRequests,
  openImport,
  recordImportForms,
  unclearZip,
} from "./support/plan-import-dialog-files";
import { realClick } from "./support/real-click";

// A loaded box answers slowly: wait far longer than the default 5 s.
const expect = baseExpect.configure({ timeout: 60_000 });
test.setTimeout(150_000);

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
  await expect(alert).toContainText("This file cannot be imported: Register file line 3", {
    timeout: 30_000,
  });
  await expect(alert).toContainText("is not an amount");
  await expect(dialog(page).getByRole("button", { name: /Drop the files here/ })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toContain("dry_run=true");
  await realClick(page, dialog(page).getByRole("button", { name: "Cancel", exact: true }));
  await expect(dialog(page)).toHaveCount(0);
  expect(logs.filter((l) => l.includes("1,23.45") || l.includes("Bad Checking"))).toEqual([]);
});
