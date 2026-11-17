import { expect, test } from "./fixtures";
import { fakeBankAccount, fakeConnection } from "./support/bank-link-stub";
import {
  box,
  connectionGets,
  dialogNamed,
  listGets,
  oneAccountBank,
  openDetail,
  openList,
  posts,
  setup,
  sidebar,
} from "./support/manage-connections-seed";
import { stubPlaidLink } from "./support/plaid-stub";
import { realClick } from "./support/real-click";

test("1 ways in: the sidebar button under Add Account, the plan menu entry, no hook", async ({
  page,
  request,
}) => {
  const { budgetId } = await setup(page, request, (z) => [z.connection]);
  const add = sidebar(page).getByRole("button", { name: "Add Account", exact: true });
  const button = sidebar(page).getByRole("button", { name: "Bank Connections", exact: true });
  const a = await box(add);
  const b = await box(button);
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(b.x).toBe(a.x);
  const url = page.url();
  const dialog = await openList(page);
  await expect(dialog.getByRole("button", { name: "Add a New Bank Connection" })).toBeVisible();
  expect(page.url()).toBe(url);
  await realClick(page, dialog.getByRole("button", { name: "Close" }));
  await expect(dialog).toHaveCount(0);

  await realClick(page, sidebar(page).locator("button.plan-button"));
  const entry = page.getByRole("menuitem", { name: "Manage Bank Connections" });
  await expect(entry).not.toHaveAttribute("aria-disabled", "true");
  await realClick(page, entry);
  await expect(dialogNamed(page, "Manage Bank Connections")).toBeVisible();
  expect(page.url()).toBe(url);
  await page.keyboard.press("Escape");
  await expect(dialogNamed(page, "Manage Bank Connections")).toHaveCount(0);

  await page.goto(`/${budgetId}/budget?add-accounts=connections`);
  await expect(sidebar(page).getByRole("link", { name: /ZZ Linked/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("1b narrow sidebar reads Connections", async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem("sidebar-preferred-width", "200"));
  await setup(page, request, (z) => [z.connection]);
  await expect(
    sidebar(page).getByRole("button", { name: "Connections", exact: true }),
  ).toBeVisible();
});

test("2 one healthy connection: one group, the three lines, a green dot, no badge, one read", async ({
  page,
  request,
}) => {
  const { stub } = await setup(page, request, (z) => [z.connection]);
  const dialog = await openList(page);
  await expect(dialog.locator(".account-modal-body h3")).toHaveText(["All Others"]);
  const row = dialog.getByRole("button", { name: "ZZ Bank", exact: true });
  await expect(row).toContainText("2 Accounts");
  await expect(row).toContainText("ID: 0a1b2c");
  await expect(row.locator(".mc-badge")).toHaveCount(0);
  const [dot, positive] = await Promise.all([
    row.locator(".mc-dot").evaluate((el) => getComputedStyle(el).backgroundColor),
    page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(
        "--statusPositive",
      );
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    }),
  ]);
  expect(dot).toBe(positive);
  expect(listGets(stub.requests)).toHaveLength(1);
});

test("3 groups in order with their badges", async ({ page, request }) => {
  await setup(page, request, (z) => [
    z.connection,
    oneAccountBank("ZZ Late", "delayed", "1d2e3f"),
    oneAccountBank("ZZ Locked", "login_required", "4a5b6c"),
  ]);
  const dialog = await openList(page);
  await expect(dialog.locator(".account-modal-body h3")).toHaveText([
    "Needs Attention",
    "Delayed",
    "All Others",
  ]);
  await expect(
    dialog.getByRole("button", { name: "ZZ Locked", exact: true }).locator(".mc-badge"),
  ).toHaveText("Repair");
  await expect(
    dialog.getByRole("button", { name: "ZZ Late", exact: true }).locator(".mc-badge"),
  ).toHaveText("Delayed");
  await expect(dialog.getByRole("button", { name: "ZZ Late", exact: true })).toContainText(
    "1 Account",
  );
  await expect(dialog.getByRole("button", { name: "ZZ Late", exact: true })).not.toContainText(
    "1 Accounts",
  );
});

test("4 empty list, its button and the Sandbox pill", async ({ page, request }) => {
  await setup(page, request, () => []);
  const dialog = await openList(page);
  await expect(dialog.getByText("No bank connections yet.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add a New Bank Connection" })).toBeVisible();
  await expect(dialog.getByText("Sandbox", { exact: true })).toBeVisible();
});

test("5 Add a New Bank Connection: search with Back, sign-in, Add Accounts, the new row", async ({
  page,
  request,
}) => {
  const fresh = fakeConnection({
    nickname: "ZZ Fresh",
    display_id: "9f8e7d",
    accounts: [
      fakeBankAccount({ name: "ZZ New A", mask: "2222" }),
      fakeBankAccount({ name: "ZZ New B", mask: "3333" }),
    ],
  });
  const { stub } = await setup(page, request, () => [], { newConnection: fresh });
  await stubPlaidLink(page, {
    success: {
      public_token: "public-test-token",
      institution: { name: "ZZ Fresh", institution_id: "ins_test_1" },
    },
  });
  let dialog = await openList(page);
  await realClick(page, dialog.getByRole("button", { name: "Add a New Bank Connection" }));
  const add = dialogNamed(page, "Add Accounts");
  await expect(add.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(add.getByRole("button", { name: "Add an Unlinked Account" })).toHaveCount(0);
  // Back on the search returns to the list.
  await realClick(page, add.getByRole("button", { name: "Back" }));
  dialog = dialogNamed(page, "Manage Bank Connections");
  await expect(dialog).toBeVisible();
  await realClick(page, dialog.getByRole("button", { name: "Add a New Bank Connection" }));
  await realClick(page, add.getByRole("button", { name: "ZZ Test Bank 1" }));
  await expect(add.getByText("ZZ New A – 2222", { exact: true })).toBeVisible();
  await realClick(page, add.getByRole("button", { name: "Next" }));
  await realClick(page, add.getByRole("button", { name: "Add 2 Accounts" }));
  await expect.poll(() => posts(stub.requests, "POST", /\/accounts\/from-bank$/).length).toBe(1);
  dialog = dialogNamed(page, "Manage Bank Connections");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "ZZ Fresh", exact: true })).toBeVisible();
});

test("6 detail: every element, no connection read", async ({ page, request }) => {
  const synced = new Date(2026, 10, 15, 14, 30).toISOString();
  const { stub } = await setup(page, request, (z) => [z.connection], {
    zz: { last_synced_at: synced },
  });
  const detail = await openDetail(page, "ZZ Bank");
  await expect(detail.getByText("Connected", { exact: true })).toBeVisible();
  await expect(detail.getByLabel("Nickname")).toHaveValue("ZZ Bank");
  await expect(detail.getByRole("heading", { name: "Linked in this plan" })).toBeVisible();
  const checking = detail.getByRole("button", { name: "ZZ Checking – 0000", exact: true });
  await expect(checking).toContainText("Checking | $1,250.50");
  await expect(checking).toContainText("Linked to ZZ Linked");
  await expect(
    detail.getByRole("button", { name: "ZZ Savings – 1111", exact: true }),
  ).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Bank Connection Details" })).toBeVisible();
  await expect(detail.locator(".mc-details")).toContainText("Bank NameZZ Bank");
  await expect(detail.locator(".mc-details")).toContainText("Bank Connection ID0a1b2c");
  await expect(detail.locator(".mc-details")).toContainText("Import ProviderPlaid");
  await expect(detail.locator(".mc-synced")).toHaveText(/^Last synced .+ at .+/);
  await expect(detail.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
  await expect(detail.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(connectionGets(stub.requests)).toHaveLength(0);
});

test("6b detail: not linked in this plan, and not synced yet", async ({ page, request }) => {
  // The plan's own sync would stamp the connection: it fails here, so the connection stays unsynced.
  await setup(page, request, () => [oneAccountBank("ZZ Other", "connected", "aa11bb")], {
    afterSync: { status: 500 },
  });
  const detail = await openDetail(page, "ZZ Other");
  await expect(detail.getByRole("heading", { name: "Not linked in this plan" })).toBeVisible();
  await expect(detail.getByText("Not synced yet", { exact: true })).toBeVisible();
});

test("7 rename: one PATCH, the title and the row follow, one list read; a 422 shows its message", async ({
  page,
  request,
}) => {
  const { stub } = await setup(page, request, (z) => [z.connection]);
  let detail = await openDetail(page, "ZZ Bank");
  await detail.getByLabel("Nickname").fill("ZZ Renamed");
  await realClick(page, detail.getByRole("button", { name: "Save", exact: true }));
  await expect
    .poll(() => posts(stub.requests, "PATCH", /\/bank-connections\/[^/]+$/).length)
    .toBe(1);
  const patch = stub.requests.find((r) => r.method === "PATCH");
  expect(patch?.body).toEqual({ nickname: "ZZ Renamed" });
  detail = dialogNamed(page, "ZZ Renamed");
  await expect(detail).toBeVisible();
  await realClick(page, detail.getByRole("button", { name: "Back" }));
  await expect(
    dialogNamed(page, "Manage Bank Connections").getByRole("button", {
      name: "ZZ Renamed",
      exact: true,
    }),
  ).toBeVisible();
  expect(listGets(stub.requests)).toHaveLength(1);
});

test("7b rename refused: the server's message shows", async ({ page, request }) => {
  await setup(page, request, (z) => [z.connection], {
    rename: { status: 422, name: "validation_error", detail: "ZZ nickname refused" },
  });
  const detail = await openDetail(page, "ZZ Bank");
  await detail.getByLabel("Nickname").fill("ZZ Other");
  await realClick(page, detail.getByRole("button", { name: "Save", exact: true }));
  await expect(detail.getByRole("alert")).toHaveText("ZZ nickname refused");
});
