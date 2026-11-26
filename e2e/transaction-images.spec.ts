import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { call, seed, TODAY } from "./support/register-seed";
import { PNG, PNG_FILE } from "./support/transaction-images";

// EXF-536: one image per transaction; the column honours View > Show Images.

test.use({ viewport: { width: 1440, height: 900 } });

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const rowOf = (page: Page, text: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: text });
const viewer = (page: Page) => page.getByRole("dialog", { name: "Transaction Photo", exact: true });

async function setup(request: Parameters<typeof seed>[0], payee: string) {
  const s = await seed(request, false);
  const t = await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: TODAY,
    amount: -12000,
    payee_name: payee,
  });
  return { ...s, id: t.transaction.id as string };
}

async function openAccount(page: Page, plan: string, account?: string) {
  await page.goto(account ? `/${plan}/accounts/${account}` : `/${plan}/accounts`);
  await expect(button(page, "Add Transaction")).toBeVisible();
  await expect(page.locator(".register-table[aria-busy=false]")).toBeVisible();
}

const imageStatus = async (request: Parameters<typeof seed>[0], plan: string, id: string) =>
  (
    await request.fetch(`/api/v1/budgets/${plan}/transactions/${id}/image`, {
      headers: await authHeaders(),
    })
  ).status();

async function attach(page: Page, row: ReturnType<typeof rowOf>) {
  const chooser = page.waitForEvent("filechooser");
  await row.getByRole("button", { name: "Add Image", exact: true }).click();
  const fc = await chooser;
  expect(await fc.element().getAttribute("accept")).toBe(
    "image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml",
  );
  await fc.setFiles(PNG_FILE);
  await expect(row.getByRole("button", { name: "Transaction Photo", exact: true })).toBeVisible();
}

test("the photo icon uploads a PNG and the row shows a thumbnail (Acc. 1)", async ({
  page,
  request,
}) => {
  const payee = `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}`;
  const s = await setup(request, payee);
  await openAccount(page, s.plan, s.checking);
  const row = rowOf(page, payee);
  await expect(row.getByRole("button", { name: "Add Image", exact: true })).toHaveAttribute(
    "title",
    "Add Image",
  );
  await attach(page, row);
  const thumb = row.getByRole("button", { name: "Transaction Photo", exact: true });
  await expect(thumb).toHaveAttribute("title", "Transaction Photo");
  await expect(thumb.locator("img")).toBeVisible();
  expect(await imageStatus(request, s.plan, s.id)).toBe(200);
});

test("the thumbnail opens the overlay; Close and Escape close it (Acc. 2)", async ({
  page,
  request,
}) => {
  const payee = `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}`;
  const s = await setup(request, payee);
  await openAccount(page, s.plan, s.checking);
  const row = rowOf(page, payee);
  await attach(page, row);
  const thumb = row.getByRole("button", { name: "Transaction Photo", exact: true });
  await thumb.click();
  await expect(viewer(page)).toBeVisible();
  for (const name of ["Delete Image", "Download Image", "Close"]) {
    await expect(viewer(page).getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(viewer(page).locator("img")).toBeVisible();
  await button(page, "Close").click();
  await expect(viewer(page)).toHaveCount(0);
  await thumb.click();
  await expect(viewer(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toHaveCount(0);
});

test("Download Image saves the original file, byte-equal (Acc. 3)", async ({ page, request }) => {
  const payee = `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}`;
  const s = await setup(request, payee);
  await openAccount(page, s.plan, s.checking);
  const row = rowOf(page, payee);
  await attach(page, row);
  await row.getByRole("button", { name: "Transaction Photo", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    button(page, "Download Image").click(),
  ]);
  expect(download.suggestedFilename()).toBe("receipt.png");
  expect(readFileSync(await download.path()).equals(PNG)).toBe(true);
});

test("Delete Image asks first; Delete removes it and GET answers 404 (Acc. 4)", async ({
  page,
  request,
}) => {
  const payee = `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}`;
  const s = await setup(request, payee);
  await openAccount(page, s.plan, s.checking);
  const row = rowOf(page, payee);
  await attach(page, row);
  await row.getByRole("button", { name: "Transaction Photo", exact: true }).click();
  await button(page, "Delete Image").click();
  const confirm = page.getByRole("dialog", { name: "Delete Image", exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText("Are you sure you want to delete this image?")).toBeVisible();
  // Escape closes only the confirm; the viewer stays
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(viewer(page)).toBeVisible();
  await button(page, "Delete Image").click();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await button(page, "Delete Image").click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Add Image", exact: true })).toBeVisible();
  expect(await imageStatus(request, s.plan, s.id)).toBe(404);
});

test("Show Images hides the column in an account and in All Accounts (Acc. 5)", async ({
  page,
  request,
}) => {
  const payee = `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}`;
  const s = await setup(request, payee);
  const column = (p: Page) => ({
    th: p.locator(".register-table th.cell-image"),
    td: p.locator(".register-table td.cell-image"),
    col: p.locator(".register-table col.col-image"),
  });
  const hideImages = async () => {
    await page
      .getByRole("toolbar", { name: "Register toolbar" })
      .getByRole("button", { name: "View", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "View Options", exact: true });
    await dialog.getByRole("checkbox", { name: "Show Images", exact: true }).uncheck();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("view_settings") && r.request().method() === "PUT",
      ),
      dialog.getByRole("button", { name: "Apply", exact: true }).click(),
    ]);
  };
  for (const account of [s.checking, undefined]) {
    await openAccount(page, s.plan, account);
    const c = column(page);
    await expect(c.th).toHaveCount(1);
    await expect(c.col).toHaveCount(1);
    await expect(c.td.first()).toBeVisible();
    // every body row keeps as many cells as the header
    const headCells = await page.locator(".register-table thead th").count();
    expect(await rowOf(page, payee).locator("td").count()).toBe(headCells);
    await hideImages();
    await expect(c.th).toHaveCount(0);
    await expect(c.td).toHaveCount(0);
    await expect(c.col).toHaveCount(0);
  }
});

test("All Accounts has the column and attaches an image", async ({ page, request }) => {
  const payee = `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}`;
  const s = await setup(request, payee);
  await openAccount(page, s.plan);
  const row = rowOf(page, payee);
  await attach(page, row);
  expect(await imageStatus(request, s.plan, s.id)).toBe(200);
});

test("a non-image file is refused and the row keeps its icon", async ({ page, request }) => {
  const payee = `ZZ-TEST ${crypto.randomUUID().slice(0, 8)}`;
  const s = await setup(request, payee);
  await openAccount(page, s.plan, s.checking);
  const row = rowOf(page, payee);
  const chooser = page.waitForEvent("filechooser");
  await row.getByRole("button", { name: "Add Image", exact: true }).click();
  await (await chooser).setFiles({
    name: "notes.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(row.getByRole("alert")).toBeVisible();
  await expect(row.getByRole("button", { name: "Add Image", exact: true })).toBeVisible();
  expect(await imageStatus(request, s.plan, s.id)).toBe(404);
});
