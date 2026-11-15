import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

test("the shell loads, navigates and opens the Add Account modal", async ({ page, request }) => {
  const name = testName("shell");
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name },
  });
  const { id } = (await res.json()).data.budget;

  await page.goto(`/${id}/budget`);
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  await expect(sidebar.getByRole("button", { name })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Plan", exact: true })).toHaveClass(/active/);
  await expect(sidebar.getByRole("link", { name: "Reflect" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "All Accounts" })).toBeVisible();
  await expect(sidebar.getByText("No Accounts")).toBeVisible();
  await expect(page).toHaveTitle(`Plan | ${name} | Budget`);

  await sidebar.getByRole("link", { name: "Reflect" }).click();
  await expect(page).toHaveURL(`/${id}/reflect/spending-breakdown`);
  await expect(page).toHaveTitle(`Spending Breakdown | ${name} | Budget`);
  await expect(sidebar.getByRole("link", { name: "Reflect" })).toHaveClass(/active/);

  await sidebar.getByRole("link", { name: "All Accounts" }).click();
  await expect(page).toHaveURL(`/${id}/accounts`);
  await expect(page).toHaveTitle(`All Accounts | ${name} | Budget`);

  await sidebar.getByRole("button", { name: "Add Account" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Accounts" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("an unknown plan shows Plan not found", async ({ page }) => {
  await page.goto(`/${crypto.randomUUID()}/budget`);
  await expect(page.getByText("Plan not found")).toBeVisible();
});
