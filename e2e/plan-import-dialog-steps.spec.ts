import type { APIRequestContext, Page } from "@playwright/test";
import { expect as baseExpect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import {
  chooseFiles,
  importRequests,
  largePair,
  openImport,
} from "./support/plan-import-dialog-files";
import { realClick } from "./support/real-click";

// The first request of a 6,000-row file is the slowest step: a loaded box needs far more than 5 s for it.
const expect = baseExpect.configure({ timeout: 60_000 });
test.setTimeout(150_000);

test.use({ viewport: { width: 1440, height: 900 } });

const dialog = (page: Page) => page.getByRole("dialog", { name: "Import Plan", exact: true });
const button = (page: Page, name: string) =>
  dialog(page).getByRole("button", { name, exact: true });

async function plansNamed(request: APIRequestContext, name: string): Promise<string[]> {
  const res = await request.get("/api/v1/budgets", { headers: await authHeaders() });
  const list = (await res.json()).data.budgets as { id: string; name: string }[];
  return list.filter((b) => b.name === name).map((b) => b.id);
}
async function cleanup(request: APIRequestContext, name: string) {
  for (const id of await plansNamed(request, name))
    await request.delete(`/api/v1/budgets/${id}`, { headers: await authHeaders() });
}

/** Opens the dialog with a file of 6,000 rows, the name set, and the continue answers slowed (they still reach the server). */
async function ready(page: Page, name: string, delayMs = 400, gate?: Promise<void>) {
  await page.route("**/budgets/import/*/continue", async (route) => {
    await (gate ?? new Promise((r) => setTimeout(r, delayMs)));
    await route.fallback();
  });
  await openImport(page);
  await chooseFiles(page, largePair(6000));
  await dialog(page).getByLabel("Plan name", { exact: true }).fill(name);
  await expect(button(page, "Import")).toBeEnabled();
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("10 several steps: progress advances, continues never overlap, then the result", async ({
  page,
  request,
}) => {
  const name = testName("steps");
  try {
    const inFlight = { now: 0, max: 0, sent: 0 };
    page.on("request", (r) => {
      if (!r.url().endsWith("/continue")) return;
      inFlight.now++;
      inFlight.sent++;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
    });
    const end = () => {
      inFlight.now--;
    };
    page.on("requestfinished", (r) => r.url().endsWith("/continue") && end());
    page.on("requestfailed", (r) => r.url().endsWith("/continue") && end());
    await ready(page, name);
    await realClick(page, button(page, "Import"));
    const bar = dialog(page).getByRole("progressbar", { name: "Import progress" });
    await expect(bar).toBeVisible();
    await expect(bar).not.toHaveAttribute("aria-valuemax", "0");
    const count = Number(await bar.getAttribute("aria-valuemax"));
    expect(count).toBeGreaterThanOrEqual(3);
    const seen = new Set<string>();
    await expect
      .poll(async () => {
        const t = await dialog(page)
          .getByText(/^Writing step \d+ of \d+$/)
          .allTextContents();
        for (const x of t) seen.add(x);
        return await dialog(page).getByText(`Imported ${name}.`, { exact: true }).count();
      })
      .toBe(1);
    expect(seen.size).toBeGreaterThanOrEqual(2);
    expect(seen.has(`Writing step 1 of ${count}`)).toBe(true);
    expect(inFlight.max).toBe(1);
    expect(inFlight.sent).toBe(count);
    expect(await plansNamed(request, name)).toHaveLength(1);
  } finally {
    await cleanup(request, name);
  }
});

test("11 cancel: asks once, Keep importing goes on, yes removes everything", async ({
  page,
  request,
}) => {
  const name = testName("cancel");
  try {
    const requests = importRequests(page);
    // The continues are held on a gate the test opens, so the import stays in "writing" for every step below.
    let open = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    await ready(page, name, 0, gate);
    await realClick(page, button(page, "Import"));
    await expect(dialog(page).getByRole("progressbar")).toBeVisible();
    // Cancel import is disabled until the start request has answered.
    await expect(button(page, "Cancel import")).toBeEnabled();
    // Keep importing: the question goes away and the import carries on.
    await realClick(page, button(page, "Cancel import"));
    await expect(
      dialog(page).getByText("Cancel this import? Everything written so far is removed.", {
        exact: true,
      }),
    ).toBeVisible();
    await realClick(page, button(page, "Keep importing"));
    await expect(dialog(page).getByText(/^Cancel this import/)).toHaveCount(0);
    await expect(dialog(page).getByText(/^Writing step \d+ of \d+$/)).toBeVisible();
    // The close button asks the same question.
    await realClick(page, dialog(page).getByRole("button", { name: "Close", exact: true }));
    await expect(dialog(page).getByText(/^Cancel this import/)).toBeVisible();
    await realClick(page, button(page, "Keep importing"));
    // Yes: one DELETE, nothing kept.
    await realClick(page, button(page, "Cancel import"));
    await realClick(page, button(page, "Cancel import"));
    open();
    await expect(
      dialog(page).getByText("The import was cancelled. Nothing was kept.", { exact: true }),
    ).toBeVisible();
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
    const sentAfter = requests.length;
    await page.waitForTimeout(1500);
    expect(requests.length).toBe(sentAfter);
    expect(await plansNamed(request, name)).toEqual([]);
    await realClick(
      page,
      dialog(page).locator(".dialog-footer").getByRole("button", { name: "Close", exact: true }),
    );
    await expect(dialog(page)).toHaveCount(0);
  } finally {
    await cleanup(request, name);
  }
});

test("12 a failed step: Try again and Cancel import, never a spinner; Try again finishes", async ({
  page,
  request,
}) => {
  const name = testName("failed");
  try {
    await ready(page, name, 0);
    // The one stand-in: the server's own answer for a step that did not apply; it never reaches the server.
    await page.route(
      "**/budgets/import/*/continue",
      (route) =>
        route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              id: "422",
              name: "import_failed",
              detail: "The step did not apply; call continue again",
            },
          }),
        }),
      { times: 1 },
    );
    await realClick(page, button(page, "Import"));
    await expect(
      dialog(page).getByText(/This step could not be written: The step did not apply/),
    ).toBeVisible();
    await expect(button(page, "Try again")).toBeVisible();
    await expect(button(page, "Cancel import")).toBeVisible();
    await realClick(page, button(page, "Try again"));
    await expect(dialog(page).getByText(`Imported ${name}.`, { exact: true })).toBeVisible();
    expect(await plansNamed(request, name)).toHaveLength(1);
  } finally {
    await cleanup(request, name);
  }
});

test("11b closing while the first request is still out cancels the import it starts", async ({
  page,
  request,
}) => {
  const name = testName("early");
  try {
    const requests = importRequests(page);
    await page.route("**/api/v1/budgets/import", async (route) => {
      if (route.request().method() === "POST" && !route.request().url().includes("dry_run")) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      await route.fallback();
    });
    await openImport(page);
    await chooseFiles(page, largePair(6000));
    await dialog(page).getByLabel("Plan name", { exact: true }).fill(name);
    await expect(button(page, "Import")).toBeEnabled();
    await realClick(page, button(page, "Import"));
    await expect(dialog(page).getByText("Starting the import…")).toBeVisible();
    await page.keyboard.press("Escape");
    await realClick(page, button(page, "Cancel import"));
    await expect(dialog(page)).toHaveCount(0, { timeout: 15000 });
    await expect.poll(() => requests.filter((r) => r.method === "DELETE").length).toBe(1);
    expect(await plansNamed(request, name)).toEqual([]);
  } finally {
    await cleanup(request, name);
  }
});

test("11c a start that answers 201 before the cancel acts shows the result", async ({
  page,
  request,
}) => {
  const name = testName("quick");
  try {
    const requests = importRequests(page);
    await page.route("**/api/v1/budgets/import", async (route) => {
      if (route.request().method() === "POST" && !route.request().url().includes("dry_run")) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      await route.fallback();
    });
    await openImport(page);
    await chooseFiles(page, largePair(5));
    await dialog(page).getByLabel("Plan name", { exact: true }).fill(name);
    await expect(button(page, "Import")).toBeEnabled();
    await realClick(page, button(page, "Import"));
    await expect(dialog(page).getByText("Starting the import…")).toBeVisible();
    await page.keyboard.press("Escape");
    await realClick(page, button(page, "Cancel import"));
    await expect(dialog(page).getByText(`Imported ${name}.`, { exact: true })).toBeVisible({
      timeout: 15000,
    });
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
    expect(await plansNamed(request, name)).toHaveLength(1);
  } finally {
    await cleanup(request, name);
  }
});

test("13 step 1 shows a started bar: the fill is visible while aria-valuenow is still 0", async ({
  page,
  request,
}) => {
  const name = testName("bar");
  try {
    let open = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    await ready(page, name, 0, gate);
    await realClick(page, button(page, "Import"));
    const bar = dialog(page).getByRole("progressbar", { name: "Import progress" });
    await expect(dialog(page).getByText(/^Writing step 1 of \d+$/)).toBeVisible();
    await expect(bar).toHaveAttribute("aria-valuenow", "0");
    const track = await bar.boundingBox();
    const fill = await bar.locator("> div").boundingBox();
    expect(track?.width).toBeGreaterThan(100);
    // A person reads a fill of at least a few pixels as "started".
    expect(fill?.width).toBeGreaterThanOrEqual(8);
    await dialog(page).screenshot({ path: "test-results/plan-import-step1.png" });
    open();
    await expect(dialog(page).getByText(`Imported ${name}.`, { exact: true })).toBeVisible();
  } finally {
    await cleanup(request, name);
  }
});

test("14 a cancel while the server has already removed the import: its words, no retry, no DELETE", async ({
  page,
  request,
}) => {
  const name = testName("gone");
  try {
    const requests = importRequests(page);
    let open = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    await ready(page, name, 0, gate);
    // The server's own answers once it has removed the import; they never reach the server.
    await page.unroute("**/budgets/import/*/continue");
    await page.route("**/budgets/import/*/continue", async (route) => {
      await gate;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            id: "409",
            name: "import_abandoned",
            detail: "This import was cancelled or expired; start again",
          },
        }),
      });
    });
    await page.route("**/budgets/import/*", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: { id: "404", name: "not_found", detail: "Import not found" },
        }),
      });
    });
    await realClick(page, button(page, "Import"));
    await expect(button(page, "Cancel import")).toBeEnabled();
    await realClick(page, button(page, "Cancel import"));
    await realClick(page, button(page, "Cancel import"));
    open();
    await expect(
      dialog(page).getByText(
        "This import was cancelled or expired; start again Nothing was kept.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect(dialog(page).getByText(/could not be cancelled/)).toHaveCount(0);
    await expect(button(page, "Try again")).toHaveCount(0);
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
  } finally {
    await cleanup(request, name);
  }
});
