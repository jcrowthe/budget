import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { BANNER } from "./support/approve-seed";
import { authHeaders } from "./support/auth";
import { importViaApi, seedFileImport } from "./support/file-import-seed";
import { showOnlyPlans } from "./support/plans";
import { realClick, TODAY, txs } from "./support/register-seed";

// EXF-531 (FI-4): the File Import dialogs in the register. The numbered tests are the contract's AC1-AC13.
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "file-import");
const fixture = (name: string) => path.join(FIX, name);

test.use({ viewport: { width: 1440, height: 900 } });
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const d1 = (page: Page) => page.getByRole("dialog", { name: "File Import", exact: true });
const d2 = (page: Page) => page.getByRole("dialog", { name: "Import Transactions", exact: true });
const result = (page: Page) => page.getByRole("dialog", { name: /^Import (Successful|Matched)$/ });
const toolbarButton = (page: Page) =>
  page.getByRole("button", { name: "File Import", exact: true });
const input = (page: Page) => page.locator("input[data-file-import-input]");
const previewRows = (page: Page) => d2(page).getByRole("table").locator("tbody tr");

async function open(page: Page, s: { plan: string; checking: string }, account = s.checking) {
  await showOnlyPlans(page, (p) => p.id === s.plan);
  await page.goto(`/${s.plan}/accounts/${account}`);
  await realClick(page, toolbarButton(page));
}

/** Opens dialog 1, chooses `file` and waits for dialog 2 with its rows. */
async function toPreview(
  page: Page,
  s: { plan: string; checking: string },
  file: string | { name: string; mimeType: string; buffer: Buffer },
) {
  await open(page, s);
  await realClick(page, d1(page).getByRole("button", { name: "Choose File", exact: true }));
  await input(page).setInputFiles(typeof file === "string" ? fixture(file) : file);
  await expect(d2(page)).toBeVisible();
  await expect(previewRows(page).first()).toBeVisible();
}

const importButton = (page: Page) => d2(page).getByRole("button", { name: "Import", exact: true });
const rowsOf = (page: Page) => page.locator(".register-table tbody tr[data-tx]");
const check = (page: Page, name: string) => d2(page).getByRole("checkbox", { name, exact: true });
const imports = (request: APIRequestContext, plan: string, account: string) =>
  txs(request, plan, account);

async function runImport(page: Page) {
  await realClick(page, importButton(page));
  await expect(result(page)).toBeVisible();
}

test.describe("AC1 dialog 1", () => {
  test("AC1 File Import opens dialog 1 with the copy and the exact accept list", async ({
    page,
    request,
  }) => {
    const s = await seedFileImport(request, { closed: true });
    await open(page, s);
    const d = d1(page);
    await expect(d).toBeVisible();
    await expect(d).toContainText(
      "To import transactions without linking your financial institution, first download a set of transactions from your bank or credit card website.",
    );
    const em = d.locator("em");
    await expect(em).toContainText("Recommended formats: OFX, QFX, and CSV");
    await expect(em).toContainText("Supported formats: QIF");
    await expect(d.getByRole("note")).toHaveText(
      "Worried about duplicates? Transactions entered by you will match automatically. Direct Import duplicates are skipped.",
    );
    await expect(d.getByRole("checkbox", { name: "Don't show again", exact: true })).toBeVisible();
    await expect(d.getByRole("button", { name: "Choose File", exact: true })).toBeVisible();
    await expect(d.getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await expect(d.getByText("Learn More")).toHaveCount(0);
    await expect(input(page)).toHaveAttribute("accept", ".csv,.tsv,.ofx,.qfx,.qif");
    expect(await input(page).evaluate((el) => (el as HTMLInputElement).multiple)).toBe(false);
  });

  test("AC1 File Import is disabled in a closed account", async ({ page, request }) => {
    const s = await seedFileImport(request, { closed: true });
    await showOnlyPlans(page, (p) => p.id === s.plan);
    await page.goto(`/${s.plan}/accounts/${s.old}`);
    await expect(toolbarButton(page)).toBeDisabled();
  });
});

test("AC2 the sample CSV auto-maps and previews two signed rows", async ({ page, request }) => {
  const s = await seedFileImport(request);
  await toPreview(page, s, "sample.csv");
  await expect(d2(page)).toContainText("2 Transactions from sample.csv will be imported into");
  for (const label of ["Date", "Payee", "Memo (optional)", "Outflow", "Inflow"]) {
    await expect(d2(page).getByLabel(label, { exact: true })).toBeVisible();
  }
  const selected = (label: string) =>
    d2(page)
      .getByLabel(label, { exact: true })
      .evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent);
  expect(await selected("Date")).toBe("Date");
  expect(await selected("Payee")).toBe("Payee");
  expect(await selected("Memo (optional)")).toBe("Memo");
  expect(await selected("Outflow")).toBe("Outflow");
  expect(await selected("Inflow")).toBe("Inflow");
  await expect(previewRows(page)).toHaveCount(2);
  await expect(previewRows(page).nth(0)).toContainText("-$4.50");
  await expect(previewRows(page).nth(1)).toContainText("+$250.00");
});

test("AC3 Swap Inflow and Outflow flips both signs with no request", async ({ page, request }) => {
  const s = await seedFileImport(request);
  await toPreview(page, s, "sample.csv");
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1")) seen.push(`${r.method()} ${r.url()}`);
  });
  await realClick(page, check(page, "Swap Inflow and Outflow"));
  await expect(previewRows(page).nth(0)).toContainText("+$4.50");
  await expect(previewRows(page).nth(1)).toContainText("-$250.00");
  await page.waitForTimeout(500);
  expect(seen).toEqual([]);
});

test("AC4 No header row shows A-E and the amber icon; the popover saves a format", async ({
  page,
  request,
}) => {
  const s = await seedFileImport(request);
  await toPreview(page, s, "sample.csv");
  const icon = d2(page).getByRole("button", { name: "Date format unclear", exact: true });
  await expect(icon).toHaveCount(0);
  await realClick(page, check(page, "No header row"));
  for (const [label, letter] of [
    ["Date", "A"],
    ["Payee", "B"],
    ["Memo (optional)", "C"],
    ["Outflow", "D"],
    ["Inflow", "E"],
  ] as const) {
    const sel = d2(page).getByLabel(label, { exact: true });
    expect(
      await sel.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent),
    ).toBe(letter);
    expect(await sel.locator("option").allTextContents()).toEqual(["", "A", "B", "C", "D", "E"]);
  }
  await expect(icon).toBeVisible();
  await realClick(page, icon);
  const pop = page.getByRole("dialog", { name: "Date format", exact: true });
  await expect(pop).toContainText(
    "The date format of sample.csv is unclear. The first transaction reads Date. What date is this?",
  );
  await pop.getByLabel("Date format", { exact: true }).selectOption("MM/DD/YYYY");
  await realClick(page, pop.getByRole("button", { name: "Save", exact: true }));
  await expect(icon).toHaveCount(0);
});

test.describe("AC5 skipped rows", () => {
  test("AC5 the note counts, expands, and Import adds one row", async ({ page, request }) => {
    const s = await seedFileImport(request, { kind: "cutoff" });
    await toPreview(page, s, "sample.csv");
    const note = d2(page).getByRole("button", { name: /1 transactions will be skipped/ });
    await expect(note).toHaveText("1 transactions will be skipped ▸");
    await expect(note).toHaveAttribute("aria-expanded", "false");
    await realClick(page, note);
    await expect(d2(page)).toContainText(
      "This file has transactions dated before the account's start date or last reconciliation. Importing them will modify the start date for this account.",
    );
    await expect(previewRows(page)).toHaveCount(1);
    await runImport(page);
    await expect(result(page)).toContainText("1 transaction has been successfully imported.");
    expect(await imports(request, s.plan, s.checking)).toHaveLength(2);
  });

  test("AC5 with Include ticked, Import adds both", async ({ page, request }) => {
    const s = await seedFileImport(request, { kind: "cutoff" });
    await toPreview(page, s, "sample.csv");
    await realClick(
      page,
      check(page, "Include 1 transactions dated before account start date or last reconciliation"),
    );
    await expect(previewRows(page)).toHaveCount(2);
    await runImport(page);
    expect(await imports(request, s.plan, s.checking)).toHaveLength(3);
  });
});

test("AC6 Import shows the counts, the rows are unapproved and the banner counts them", async ({
  page,
  request,
}) => {
  const s = await seedFileImport(request);
  await toPreview(page, s, "sample.csv");
  await runImport(page);
  await expect(result(page)).toContainText("2 transactions have been successfully imported.");
  await realClick(page, result(page).getByRole("button", { name: "OK", exact: true }));
  await expect(result(page)).toHaveCount(0);
  const needs = page.getByRole("button", { name: "This transaction needs approval", exact: true });
  await expect(needs).toHaveCount(2);
  await expect(page.getByRole("region", { name: "New transactions", exact: true })).toContainText(
    BANNER(2),
  );
  await expect(toolbarButton(page)).toBeFocused();
});

test("AC7 and AC8 the worked example merges one row, and a re-import matches all", async ({
  page,
  request,
}) => {
  const s = await seedFileImport(request, { kind: "worked" });
  await toPreview(page, s, "three-rows.csv");
  await runImport(page);
  await expect(result(page).getByRole("heading", { name: "Import Successful" })).toBeVisible();
  await expect(result(page)).toContainText(
    "2 transactions have been successfully imported. 1 previously imported transaction has been matched.",
  );
  await realClick(page, result(page).getByRole("button", { name: "OK", exact: true }));
  await expect(rowsOf(page).filter({ hasText: "Corner Market" })).toHaveCount(1);
  await expect(
    rowsOf(page)
      .filter({ hasText: "Corner Market" })
      .getByRole("button", { name: "This transaction needs approval", exact: true }),
  ).toHaveCount(0);
  const bal = (k: string) => page.locator(`[data-balance="${k}"] .acct-amount`);
  await expect(bal("cleared")).toHaveText("$755.50");
  await expect(bal("uncleared")).toHaveText("−$260.00");
  await expect(bal("working")).toHaveText("$495.50");
  const before = (await imports(request, s.plan, s.checking)).length;

  // AC8: the same file again.
  await realClick(page, toolbarButton(page));
  await realClick(page, d1(page).getByRole("button", { name: "Choose File", exact: true }));
  await input(page).setInputFiles(fixture("three-rows.csv"));
  await expect(previewRows(page).first()).toBeVisible();
  await runImport(page);
  await expect(result(page).getByRole("heading", { name: "Import Matched" })).toBeVisible();
  await expect(result(page)).toContainText(
    "3 transactions have been successfully imported. All transactions were matched to already entered or imported transactions, so there's nothing else for you to do!",
  );
  expect((await imports(request, s.plan, s.checking)).length).toBe(before);
});

test("EXF-988 a file already imported is marked row by row, with the count", async ({
  page,
  request,
}) => {
  const s = await seedFileImport(request, { kind: "worked" });
  await toPreview(page, s, "three-rows.csv");
  await expect(d2(page).locator(".file-import-mark")).toHaveCount(1);
  await runImport(page);
  await realClick(page, result(page).getByRole("button", { name: "OK", exact: true }));

  await realClick(page, toolbarButton(page));
  await realClick(page, d1(page).getByRole("button", { name: "Choose File", exact: true }));
  await input(page).setInputFiles(fixture("three-rows.csv"));
  await expect(previewRows(page).first()).toBeVisible();
  await expect(d2(page).locator(".file-import-mark")).toHaveCount(3);
  await expect(previewRows(page).first()).toContainText("Already imported");
  await expect(d2(page).getByRole("status")).toHaveText(
    "3 transactions will be matched or skipped",
  );
});

test("EXF-1007 the header counts only new rows: a partly-overlapping file, then a fully re-imported one", async ({
  page,
  request,
}) => {
  const s = await seedFileImport(request, { kind: "worked" });
  // The worked example already holds one of the three rows: two are new.
  await toPreview(page, s, "three-rows.csv");
  await expect(d2(page).locator(".file-import-mark")).toHaveCount(1);
  await expect(d2(page).locator(".file-import-header")).toContainText(
    "2 Transactions from three-rows.csv will be imported into",
  );
  await runImport(page);
  await realClick(page, result(page).getByRole("button", { name: "OK", exact: true }));

  // The same file again: nothing is new, and Import stays enabled (it matches, imports no new row).
  await realClick(page, toolbarButton(page));
  await realClick(page, d1(page).getByRole("button", { name: "Choose File", exact: true }));
  await input(page).setInputFiles(fixture("three-rows.csv"));
  await expect(d2(page).locator(".file-import-mark")).toHaveCount(3);
  const head = d2(page).locator(".file-import-header");
  await expect(head).toContainText("No new transactions in three-rows.csv");
  await expect(head).not.toContainText("will be imported into");
  await expect(importButton(page)).toBeEnabled();
});

test("AC9 OFX and QIF preview without field selects and with exactly four options", async ({
  page,
  request,
}) => {
  const s = await seedFileImport(request);
  for (const file of ["sample.ofx", "sample.qif"]) {
    await toPreview(page, s, file);
    await expect(d2(page).getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
    for (const label of ["Date", "Payee", "Memo (optional)", "Outflow", "Inflow"]) {
      await expect(d2(page).getByLabel(label, { exact: true })).toHaveCount(0);
    }
    for (const h of ["DATE", "PAYEE", "MEMO", "OUTFLOW", "INFLOW"]) {
      await expect(d2(page).getByRole("columnheader", { name: h, exact: true })).toBeVisible();
    }
    await expect(d2(page).getByRole("checkbox")).toHaveCount(4);
    for (const n of [
      "Import Memos",
      "Swap Payee and Memo",
      "Swap Inflow and Outflow",
      "Remember setting for this account",
    ]) {
      await expect(check(page, n)).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(d2(page)).toHaveCount(0);
    await expect(toolbarButton(page)).toBeFocused();
    await realClick(page, toolbarButton(page));
  }
});

test("AC10 an unapproved imported row says Approve; an approved one says Save", async ({
  page,
  request,
}) => {
  const s = await seedFileImport(request);
  await importViaApi(
    request,
    s.plan,
    s.checking,
    { name: "sample.csv", buffer: readFileSync(fixture("sample.csv")) },
    TODAY,
  );
  await showOnlyPlans(page, (p) => p.id === s.plan);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const row = () => rowsOf(page).filter({ hasText: "Sample Cafe" });
  await row().locator('td[data-field="outflow"]').dblclick();
  const bar = page.locator(".entry-actions");
  await expect(bar.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await realClick(page, bar.getByRole("button", { name: "Approve", exact: true }));
  await expect(page.locator(".entry-actions")).toHaveCount(0);
  await expect(
    row().getByRole("button", { name: "This transaction needs approval", exact: true }),
  ).toHaveCount(0);
  const cafe = (await txs(request, s.plan, s.checking)).find((t) => t.payee_name === "Sample Cafe");
  expect(cafe?.approved).toBe(true);
  await row().locator('td[data-field="outflow"]').dblclick();
  await expect(
    page.locator(".entry-actions").getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".entry-actions").getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
});

test.describe("AC11 behaviour", () => {
  test("AC11 Don't show again persists across a reload", async ({ page, request }) => {
    const s = await seedFileImport(request);
    await open(page, s);
    await d1(page).getByRole("checkbox", { name: "Don't show again", exact: true }).check();
    await realClick(page, d1(page).getByRole("button", { name: "Choose File", exact: true }));
    await input(page).setInputFiles(fixture("sample.csv"));
    await expect(d2(page)).toBeVisible();
    await realClick(page, d2(page).getByRole("button", { name: "Cancel", exact: true }));
    await expect(d2(page)).toHaveCount(0);
    await page.reload();
    await expect(toolbarButton(page)).toBeVisible();
    // The setting is read from the server before the click chooses the path.
    await expect
      .poll(async () => {
        const r = await request.get(`/api/v1/budgets/${s.plan}/ui-state`, {
          headers: await authHeaders(),
        });
        return (await r.json()).data.ui_state.hide_file_import_dialog;
      })
      .toBe(true);
    const chooser = page.waitForEvent("filechooser");
    await realClick(page, toolbarButton(page));
    await chooser;
    await expect(d1(page)).toHaveCount(0);
  });

  test("AC11 the account select changes the target account", async ({ page, request }) => {
    const s = await seedFileImport(request);
    await toPreview(page, s, "sample.csv");
    const sel = d2(page).getByLabel("Account", { exact: true });
    await expect(sel.locator("option:checked")).toHaveText("ZZ Checking");
    await sel.selectOption({ label: "ZZ Savings" });
    await expect(importButton(page)).toBeEnabled();
    await expect(previewRows(page)).toHaveCount(2);
    await runImport(page);
    expect((await imports(request, s.plan, s.savings)).length).toBe(3);
    expect((await imports(request, s.plan, s.checking)).length).toBe(1);
  });

  test("AC11 Cancel and Escape close without writing, and focus returns", async ({
    page,
    request,
  }) => {
    const s = await seedFileImport(request);
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && r.url().includes("/api/v1"))
        writes.push(`${r.method()} ${r.url()}`);
    });
    await open(page, s);
    await realClick(page, d1(page).getByRole("button", { name: "Cancel", exact: true }));
    await expect(d1(page)).toHaveCount(0);
    await expect(toolbarButton(page)).toBeFocused();
    await realClick(page, toolbarButton(page));
    await page.keyboard.press("Escape");
    await expect(d1(page)).toHaveCount(0);
    await expect(toolbarButton(page)).toBeFocused();
    await realClick(page, toolbarButton(page));
    await realClick(page, d1(page).getByRole("button", { name: "Choose File", exact: true }));
    await input(page).setInputFiles(fixture("sample.csv"));
    await expect(previewRows(page).first()).toBeVisible();
    writes.length = 0;
    await realClick(page, d2(page).getByRole("button", { name: "Cancel", exact: true }));
    await expect(d2(page)).toHaveCount(0);
    await expect(toolbarButton(page)).toBeFocused();
    await realClick(page, toolbarButton(page));
    await realClick(page, d1(page).getByRole("button", { name: "Choose File", exact: true }));
    await input(page).setInputFiles(fixture("sample.csv"));
    await expect(previewRows(page).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(d2(page)).toHaveCount(0);
    await expect(toolbarButton(page)).toBeFocused();
    expect(
      writes.filter((w) => w.includes("ui-state") || /accounts\/[^/]+\/imports$/.test(w)),
    ).toEqual([]);
    expect((await imports(request, s.plan, s.checking)).length).toBe(1);
  });

  test("AC11 on All Accounts the first open account is preselected", async ({ page, request }) => {
    const s = await seedFileImport(request);
    await showOnlyPlans(page, (p) => p.id === s.plan);
    await page.goto(`/${s.plan}/accounts`);
    const first = await page
      .getByRole("navigation", { name: "Sidebar" })
      .getByRole("link", { name: /^ZZ (Checking|Savings)/ })
      .first()
      .textContent();
    await realClick(page, toolbarButton(page));
    await realClick(page, d1(page).getByRole("button", { name: "Choose File", exact: true }));
    await input(page).setInputFiles(fixture("sample.csv"));
    await expect(previewRows(page).first()).toBeVisible();
    const sel = d2(page).getByLabel("Account", { exact: true });
    await expect(sel.locator("option:checked")).toHaveText(
      /ZZ (Checking|Savings)/.exec(first ?? "")?.[0] ?? "",
    );
  });
});

for (const size of [
  { width: 1024, height: 700 },
  { width: 1440, height: 900 },
]) {
  test(`AC12 both dialogs fit at ${size.width}x${size.height} and the table scrolls inside`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(size);
    const s = await seedFileImport(request);
    const lines = ["Date,Payee,Memo,Outflow,Inflow"];
    for (let i = 0; i < 80; i++)
      lines.push(
        `11/${String((i % 28) + 1).padStart(2, "0")}/2026,Sample Row ${i},m${i},${i + 1}.00,`,
      );
    await open(page, s);
    const fits = async (loc: ReturnType<typeof d1>) => {
      const b = await loc.boundingBox();
      expect(b).not.toBeNull();
      expect((b?.x ?? -1) >= 0 && (b?.y ?? -1) >= 0).toBe(true);
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(size.width);
      expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(size.height);
    };
    await fits(d1(page));
    await realClick(page, d1(page).getByRole("button", { name: "Choose File", exact: true }));
    await input(page).setInputFiles({
      name: "many.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lines.join("\n")),
    });
    await expect(previewRows(page).first()).toBeVisible();
    await fits(d2(page));
    await expect(importButton(page)).toBeInViewport();
    const wrap = d2(page).locator(".file-import-table-wrap");
    expect(await wrap.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });
}
