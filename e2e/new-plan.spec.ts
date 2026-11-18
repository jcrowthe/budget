import { currencyByCode, NUMBER_FORMATS } from "../packages/schema/src/plan-formats-catalogue";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { newPlanDialog, newPlanField, openNewPlan, ownPlan, side } from "./support/new-plan-seed";
import { realClick } from "./support/real-click";

const planPosts = (reqs: { method: string; url: string }[]) =>
  reqs.filter((r) => r.method === "POST" && new URL(r.url).pathname === "/api/v1/budgets");

async function openFrom(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
) {
  const own = await ownPlan(request, "np");
  await page.goto(`/${own.id}/budget`);
  await expect(side(page).getByRole("button", { name: own.name, exact: true })).toBeVisible();
  await openNewPlan(page, own.name);
  return own;
}

test("AC469-1 the dialog opens with the defaults", async ({ page, request }) => {
  await openFrom(page, request);
  const d = newPlanDialog(page);
  await expect(d.getByRole("heading", { name: "New Plan", exact: true })).toBeVisible();
  await expect(d.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await expect(newPlanField(page, "Plan Name")).toHaveValue("");
  await expect(newPlanField(page, "Plan Name")).toBeFocused();
  await expect(newPlanField(page, "Currency")).toHaveValue("USD");
  await expect(newPlanField(page, "Currency Placement").locator("option:checked")).toHaveText(
    "Before amount ($123,456.78)",
  );
  await expect(newPlanField(page, "Number Format")).toHaveValue("123,456.78");
  await expect(newPlanField(page, "Date Format").locator("option:checked")).toHaveText(
    `12/30/${new Date().getFullYear()}`,
  );
  await expect(d.getByRole("button", { name: "Create Plan", exact: true })).toBeEnabled();
});

test("AC469-2 a currency sets the number formats and the placement", async ({ page, request }) => {
  await openFrom(page, request);
  await newPlanField(page, "Currency").selectOption("JPY");
  const opts = await newPlanField(page, "Number Format").locator("option").allTextContents();
  expect(opts).toEqual([...NUMBER_FORMATS[0]]);
  const jpy = currencyByCode("JPY");
  await expect(newPlanField(page, "Number Format")).toHaveValue(jpy?.number_format ?? "");
  await expect(newPlanField(page, "Number Format")).toHaveValue("123,456");

  await newPlanField(page, "Currency").selectOption("EUR");
  const eur = currencyByCode("EUR");
  await expect(newPlanField(page, "Currency Placement").locator("option")).toHaveText([
    "Before amount (€123,456.78)",
    "After amount (123,456.78€)",
    "Don't show (123,456.78)",
  ]);
  await expect(newPlanField(page, "Number Format")).toHaveValue(eur?.number_format ?? "");
  await expect(newPlanField(page, "Currency Placement")).toHaveValue(eur?.placement ?? "");
});

test("AC469-3 Cancel and Escape send nothing", async ({ page, request }) => {
  const posts: { method: string; url: string }[] = [];
  page.on("request", (r) => posts.push({ method: r.method(), url: r.url() }));
  const own = await openFrom(page, request);
  await realClick(page, newPlanDialog(page).getByRole("button", { name: "Cancel", exact: true }));
  await expect(newPlanDialog(page)).toHaveCount(0);
  await openNewPlan(page, own.name);
  await page.keyboard.press("Escape");
  await expect(newPlanDialog(page)).toHaveCount(0);
  expect(planPosts(posts)).toHaveLength(0);
});

test("AC469-4 an empty name shows the error and sends nothing", async ({ page, request }) => {
  const posts: { method: string; url: string }[] = [];
  page.on("request", (r) => posts.push({ method: r.method(), url: r.url() }));
  await openFrom(page, request);
  const create = newPlanDialog(page).getByRole("button", { name: "Create Plan", exact: true });
  await realClick(page, create);
  await expect(
    newPlanDialog(page).getByText("Plan name is required.", { exact: true }),
  ).toBeVisible();
  await newPlanField(page, "Plan Name").fill("   ");
  await realClick(page, create);
  await expect(
    newPlanDialog(page).getByText("Plan name is required.", { exact: true }),
  ).toBeVisible();
  await expect(newPlanField(page, "Plan Name")).toBeFocused();
  await page.waitForTimeout(300);
  expect(planPosts(posts)).toHaveLength(0);
});

test("AC469-5 Create Plan sends one request with the formats and opens the plan", async ({
  page,
  request,
}) => {
  const posts: { method: string; url: string; body: unknown }[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST")
      posts.push({ method: r.method(), url: r.url(), body: r.postDataJSON() });
  });
  await openFrom(page, request);
  const name = testName("np-new");
  await newPlanField(page, "Plan Name").fill(name);
  await newPlanField(page, "Currency").selectOption("EUR");
  await newPlanField(page, "Date Format").selectOption("DD.MM.YYYY");
  const eur = currencyByCode("EUR");
  await realClick(
    page,
    newPlanDialog(page).getByRole("button", { name: "Create Plan", exact: true }),
  );
  await expect(page).toHaveURL(/\/[0-9a-f-]{36}\/budget$/);
  await expect(side(page).getByRole("button", { name, exact: true })).toBeVisible();
  const sent = planPosts(posts);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toEqual({
    name,
    currency_format: {
      iso_code: "EUR",
      example_format: eur?.number_format,
      symbol_placement: eur?.placement,
    },
    date_format: { format: "DD.MM.YYYY" },
  });
  const id = page.url().match(/\/([0-9a-f-]{36})\/budget$/)?.[1];
  await expect
    .poll(async () => {
      const res = await request.get(`/api/v1/budgets/${id}`, { headers: await authHeaders() });
      const b = (await res.json()).data.budget;
      return [b.currency_format.iso_code, b.date_format.format];
    })
    .toEqual(["EUR", "DD.MM.YYYY"]);
});
