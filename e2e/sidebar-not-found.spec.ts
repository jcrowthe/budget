import { expect, test } from "@playwright/test";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";

// EXF-614: the sidebar beside "Plan not found" offers nothing on the missing plan.
test("a deleted plan's four addresses show a sidebar without actions on it", async ({
  page,
  request,
}) => {
  const headers = await authHeaders();
  const res = await request.post("/api/v1/budgets", { headers, data: { name: testName("nf") } });
  const id = (await res.json()).data.budget.id as string;
  const acc = await request.post(`/api/v1/budgets/${id}/accounts`, {
    headers,
    data: { name: "ZZ-TEST Checking", type: "checking", balance: 1000 },
  });
  const accountId = (await acc.json()).data.account.id as string;
  await request.delete(`/api/v1/budgets/${id}`, { headers });

  const withId: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(id) && !r.isNavigationRequest()) withId.push(r.url());
  });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  for (const path of [
    `/${id}/budget`,
    `/${id}/accounts`,
    `/${id}/accounts/${accountId}`,
    `/${id}/reflect/net-worth`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Plan not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to your plans" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "No Plan Open" })).toBeVisible();
    for (const n of ["Plan", "Reflect", "All Accounts"])
      await expect(sidebar.getByRole("link", { name: n, exact: true })).toHaveCount(0);
    await expect(page.getByText("No Accounts", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add Account" })).toHaveCount(0);
  }

  // The plan button still opens the menu.
  await realClick(page, sidebar.getByRole("button", { name: "No Plan Open" }));
  const menu = page.getByRole("menu", { name: "Plan" });
  await expect(menu.getByRole("menuitem", { name: "New Plan" })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(menu.getByRole("menuitem", { name: "Plan Settings" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");

  // Collapsed: the mark and the expand button only.
  await page.getByRole("button", { name: "Expand/Collapse Sidebar" }).click();
  await expect(sidebar.getByRole("link")).toHaveCount(0);
  await expect(sidebar.getByRole("button")).toHaveCount(2);
  await page.waitForTimeout(500);
  expect(withId).toEqual([]);
  expect(errors).toEqual([]);
});
