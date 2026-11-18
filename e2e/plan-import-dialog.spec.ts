import type { APIRequestContext, Page } from "@playwright/test";
import { expect as baseExpect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import {
  apiExport,
  chooseFiles,
  importRequests,
  openImport,
  seedClearPlan,
} from "./support/plan-import-dialog-files";
import { realClick } from "./support/real-click";

// A loaded box answers slowly: wait far longer than the default 5 s.
const expect = baseExpect.configure({ timeout: 60_000 });
test.setTimeout(150_000);

test.use({ viewport: { width: 1440, height: 900 } });

const dialog = (page: Page) => page.getByRole("dialog", { name: "Import Plan", exact: true });

async function removePlans(request: APIRequestContext, ...ids: string[]) {
  for (const id of ids)
    await request.delete(`/api/v1/budgets/${id}`, { headers: await authHeaders() });
}
async function plansNamed(request: APIRequestContext, name: string): Promise<string[]> {
  const res = await request.get("/api/v1/budgets", { headers: await authHeaders() });
  const list = (await res.json()).data.budgets as { id: string; name: string }[];
  return list.filter((b) => b.name === name).map((b) => b.id);
}

test("5 the button, and each refusal in words with no request", async ({ page }) => {
  const requests = importRequests(page);
  await page.goto("/plans");
  // Beside Create New Plan: the very next card of the grid (the row may wrap when many plans exist).
  const next = await page
    .getByRole("button", { name: "Create New Plan", exact: true })
    .evaluate((el) => el.closest("li")?.nextElementSibling?.querySelector("button")?.textContent);
  expect(next).toBe("Import Plan");
  await realClick(page, page.getByRole("button", { name: "Import Plan", exact: true }));
  await expect(dialog(page)).toBeVisible();
  const alert = dialog(page).getByRole("alert");
  const csv = Buffer.from("x");
  const file = (name: string, buffer = csv) => ({
    name,
    mimeType: "application/octet-stream",
    buffer,
  });

  // The drop zone opens the chooser by mouse and by Enter.
  await chooseFiles(page, [file("a.xlsx")]);
  await expect(alert).toHaveText("a.xlsx is not a .zip, .csv or .tsv file.");
  const zone = dialog(page).getByRole("button", { name: /Drop the files here/ });
  await zone.focus();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles([file("a.zip"), file("b.csv")]);
  await expect(alert).toHaveText("Choose one zip, or the two files: Plan and Register.");
  await chooseFiles(page, [file("a.csv"), file("b.csv"), file("c.csv")]);
  await expect(alert).toHaveText("Choose one zip, or the two files: Plan and Register.");
  await chooseFiles(page, [file("a.csv")]);
  await expect(alert).toHaveText("Choose both files: Plan and Register.");
  // 21 MB made in the page from one shared 1 MB chunk (a 21 MB buffer through the chooser crashed a loaded box).
  await page.evaluate(() => {
    const chunk = new Blob([new ArrayBuffer(2 ** 20)]);
    const dt = new DataTransfer();
    dt.items.add(
      new File(
        Array.from({ length: 21 }, () => chunk),
        "big.zip",
      ),
    );
    const input = document.querySelector<HTMLInputElement>("#plan-import-file");
    if (!input) throw new Error("no file input");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(alert).toHaveText("The files are larger than 20 MB, the most an import takes.");
  expect(requests).toEqual([]);
});

test("6 a consistent file: its preview from one dry run", async ({ page, request }) => {
  const seed = await seedClearPlan(request);
  try {
    const zip = await apiExport(request, seed.plan);
    const requests = importRequests(page);
    await openImport(page);
    await chooseFiles(page, [zip]);
    const d = dialog(page);
    await expect(d.getByLabel("Plan name", { exact: true })).toHaveValue(/^ZZ TEST imp /);
    const exportDate = d.getByLabel("Export date", { exact: true });
    await expect(exportDate).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);
    await expect(d.getByLabel("Currency symbol", { exact: true })).toHaveValue("$");
    await expect(d.getByLabel("Date format", { exact: true })).toHaveValue("MM/DD/YYYY");
    await expect(d.getByLabel("Type of ZZ-TEST Checking", { exact: true })).toHaveValue("checking");
    await expect(d.getByLabel("Type of ZZ-TEST Visa", { exact: true })).toHaveValue("creditCard");
    await expect(d.getByRole("heading", { name: "Counts", exact: true })).toBeVisible();
    await expect(d.getByText("Mismatches", { exact: true })).toHaveCount(0);
    await expect(d.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("dry_run=true");
  } finally {
    await removePlans(request, seed.plan);
  }
});

test("7 a one-call import: result, Open Plan, and the list refreshed once", async ({
  page,
  request,
}) => {
  const seed = await seedClearPlan(request);
  const name = testName("imp");
  try {
    const zip = await apiExport(request, seed.plan);
    const requests = importRequests(page);
    const lists: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "GET" && new URL(r.url()).pathname === "/api/v1/budgets")
        lists.push(r.url());
    });
    await openImport(page);
    await chooseFiles(page, [zip]);
    const d = dialog(page);
    await d.getByLabel("Plan name", { exact: true }).fill(name);
    await expect(d.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    const before = requests.length;
    await realClick(page, d.getByRole("button", { name: "Import", exact: true }));
    await expect(d.getByText(`Imported ${name}.`, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const sent = requests.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).not.toContain("dry_run");
    await expect
      .poll(async () => (await plansNamed(request, name)).length, { timeout: 30_000 })
      .toBe(1);
    // The plans list: refreshed once after done, never by the dialog itself.
    await expect.poll(() => lists.length).toBe(2);
    await page.waitForTimeout(500);
    expect(lists).toHaveLength(2);
    await realClick(page, d.getByRole("button", { name: "Open Plan", exact: true }));
    const [id] = await plansNamed(request, name);
    await expect(page).toHaveURL(`/${id}/budget`);
    await expect(page).toHaveTitle(new RegExp(name.replace(/[-]/g, "\\-")));
    await removePlans(request, id as string);
  } finally {
    await removePlans(request, seed.plan, ...(await plansNamed(request, name)));
  }
});
