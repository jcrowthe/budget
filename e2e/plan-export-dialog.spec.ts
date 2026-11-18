import type { Download, Page } from "@playwright/test";
import { unzip } from "../packages/schema/src/zip";
import { expect as baseExpect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { mouseClick } from "./support/menu";
import { Plan } from "./support/plan-seed";

const BODY =
  "Your data is just that—yours! All the requested data will be exported in CSV format so it's easy to open in other applications.";

// A loaded box answers slowly: wait far longer than the default 5 s.
const expect = baseExpect.configure({ timeout: 60_000 });
test.setTimeout(150_000);

test.use({ viewport: { width: 1440, height: 900 } });

const dialog = (page: Page) => page.getByRole("dialog", { name: "Export Plan", exact: true });

/** Opens the plan menu with the real mouse and picks Export Plan. */
async function openExport(page: Page) {
  await mouseClick(page, page.locator(".plan-button"));
  await mouseClick(page, page.getByRole("menuitem", { name: "Export Plan", exact: true }));
}

const exportRequests = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/export")) seen.push(r.url());
  });
  return seen;
};

async function entryNames(download: Download) {
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const files = await unzip(new Uint8Array(await readFile(path)), async (d) => d);
  return files.map((f) => f.name);
}

test("1 EXF-476 c1: the dialog's words; Cancel, Close and Escape download nothing", async ({
  page,
  request,
}) => {
  const plan = new Plan(request);
  await plan.create("exp");
  try {
    await plan.inflow(10);
    const seen = exportRequests(page);
    let downloads = 0;
    page.on("download", () => downloads++);
    await page.goto(`/${plan.id}/budget`);
    await openExport(page);
    await expect(dialog(page)).toBeVisible();
    await expect(
      dialog(page).getByRole("heading", { name: "Export Plan", exact: true }),
    ).toBeVisible();
    await expect(dialog(page).getByText(BODY, { exact: true })).toBeVisible();
    await expect(
      dialog(page).getByRole("checkbox", { name: "Don't show again", exact: true }),
    ).not.toBeChecked();
    await expect(dialog(page).getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Export", exact: true })).toBeVisible();
    await mouseClick(page, dialog(page).getByRole("button", { name: "Cancel", exact: true }));
    await expect(dialog(page)).toHaveCount(0);
    await openExport(page);
    await mouseClick(page, dialog(page).getByRole("button", { name: "Close", exact: true }));
    await expect(dialog(page)).toHaveCount(0);
    await openExport(page);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(seen).toEqual([]);
    expect(downloads).toBe(0);
  } finally {
    await plan.remove();
  }
});

test("2 Export downloads the zip under the server's name, with local time", async ({
  page,
  request,
}) => {
  const plan = new Plan(request);
  await plan.create("exp");
  try {
    await plan.inflow(10);
    await page.goto(`/${plan.id}/budget`);
    await openExport(page);
    const before = new Date();
    const waiting = page.waitForEvent("download");
    await mouseClick(page, dialog(page).getByRole("button", { name: "Export", exact: true }));
    const download = await waiting;
    await expect(dialog(page)).toHaveCount(0);
    const name = download.suggestedFilename();
    const m = /^Budget Export - (.+) as of (\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})\.zip$/.exec(name);
    expect(m, name).not.toBeNull();
    const two = (n: number) => String(n).padStart(2, "0");
    const local = (d: Date) =>
      `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}`;
    const stamp = `${m?.[2]} ${m?.[3]}-${m?.[4]}`;
    const after = new Date();
    const near = [-1, 0, 1].map((k) => local(new Date(before.getTime() + k * 60_000)));
    near.push(local(after));
    expect(near).toContain(stamp);
    const names = await entryNames(download);
    expect(names).toEqual([
      `${m?.[1]} as of ${stamp} - Plan.csv`,
      `${m?.[1]} as of ${stamp} - Register.csv`,
    ]);
  } finally {
    await plan.remove();
  }
});

test("3 EXF-476 c8: Don't show again, saved only at Export", async ({ page, request }) => {
  const plan = new Plan(request);
  const other = new Plan(request);
  await plan.create("exp");
  await other.create("exp");
  const hide = async (id: string) =>
    (
      await (
        await request.get(`/api/v1/budgets/${id}/ui-state`, { headers: await authHeaders() })
      ).json()
    ).data.ui_state.hide_plan_export_dialog;
  try {
    await other.inflow(10);
    await plan.inflow(10);
    // Tick + Cancel saves nothing.
    await page.goto(`/${other.id}/budget`);
    await openExport(page);
    await dialog(page).getByRole("checkbox", { name: "Don't show again", exact: true }).check();
    await mouseClick(page, dialog(page).getByRole("button", { name: "Cancel", exact: true }));
    await page.waitForTimeout(500);
    expect(await hide(other.id)).toBeUndefined();
    // Tick + Export saves.
    await page.goto(`/${plan.id}/budget`);
    await openExport(page);
    await dialog(page).getByRole("checkbox", { name: "Don't show again", exact: true }).check();
    const first = page.waitForEvent("download");
    await mouseClick(page, dialog(page).getByRole("button", { name: "Export", exact: true }));
    await first;
    await expect.poll(() => hide(plan.id)).toBe(true);
    // The next click downloads at once, with no dialog.
    const second = page.waitForEvent("download");
    await openExport(page);
    await second;
    await expect(dialog(page)).toHaveCount(0);
  } finally {
    await plan.remove();
    await other.remove();
  }
});

test("4 A failed export shows the server's words, never nothing", async ({ page, request }) => {
  const plan = new Plan(request);
  await plan.create("exp");
  try {
    await plan.inflow(10);
    await page.goto(`/${plan.id}/budget`);
    await openExport(page);
    await expect(dialog(page)).toBeVisible();
    await plan.remove();
    await mouseClick(page, dialog(page).getByRole("button", { name: "Export", exact: true }));
    await expect(
      dialog(page).getByText("The plan could not be exported.", { exact: true }),
    ).toBeVisible();
    // The server's own words follow the sentence (the 404's detail).
    const words = await dialog(page).locator("p").allTextContents();
    expect(words).toHaveLength(2);
    expect(words[1]?.length).toBeGreaterThan(0);
    await mouseClick(page, dialog(page).getByRole("button", { name: "OK", exact: true }));
    await expect(dialog(page)).toHaveCount(0);
  } finally {
    await plan.remove();
  }
});
