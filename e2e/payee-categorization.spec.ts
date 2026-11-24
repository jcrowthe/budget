import { expect, test } from "./fixtures";
import {
  addRow,
  categoryCombo,
  pickByMouse,
  pickByTab,
  seedCategorization,
} from "./support/payee-categorization-seed";
import { showOnlyPlans } from "./support/plans";

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

async function open(page: import("@playwright/test").Page, s: { plan: string; checking: string }) {
  await showOnlyPlans(page, (p) => p.id === s.plan);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
}

test("A1 one Fun row: the add row fills Fun when the payee is picked by mouse", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.one();
  await open(page, s);
  await addRow(page);
  await pickByMouse(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Fun");
});

test("A1 one Fun row: the add row fills Fun when the payee is picked by Tab", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.one();
  await open(page, s);
  await addRow(page);
  await pickByTab(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Fun");
});

test("A2 Groceries 11/10, 11/11, Fun 11/12: the add row fills Groceries (Tab)", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.majority();
  await open(page, s);
  await addRow(page);
  await pickByTab(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Groceries");
});

test("A2 Groceries 11/10, 11/11, Fun 11/12: the add row fills Groceries (mouse)", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.majority();
  await open(page, s);
  await addRow(page);
  await pickByMouse(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Groceries");
});

test("A3 Groceries 11/10 then Fun 11/12: the add row fills Groceries", async ({
  page,
  request,
}) => {
  const s = await seedCategorization(request);
  const n = await s.tie();
  await expect
    .poll(async () => (await s.payee(n)).default_category_id, { timeout: 15000 })
    .toBe(s.groceries);
  await open(page, s);
  await addRow(page);
  await pickByTab(page, n);
  await expect(categoryCombo(page)).toHaveValue("ZZ Daily: Groceries");
});
