import { pickLastOpened } from "../apps/web/src/shell/useCurrentPlan";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { mouseClick } from "./support/menu";
import { showOnlyPlans } from "./support/plans";

// Route callbacks still fetching when a test ends would otherwise surface as an error outside any test.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

type Row = Parameters<typeof pickLastOpened>[0][number];
const plan = (id: string, last_opened_at: string | null) =>
  ({ id, name: id, last_opened_at, bank_environment: "sandbox" }) as unknown as Row;

test("/ opens the plan opened last: pickLastOpened (EXF-569)", () => {
  const a = plan("a", "2026-01-01T00:00:00.000Z");
  const b = plan("b", "2026-01-03T00:00:00.000Z");
  const c = plan("c", "2026-01-02T00:00:00.000Z");
  expect(pickLastOpened([a, b, c])?.id).toBe("b");
  expect(pickLastOpened([c, b, a])?.id).toBe("b");
  expect(pickLastOpened([plan("a", null), plan("b", "2026-01-01T00:00:00.000Z")])?.id).toBe("b");
  expect(pickLastOpened([plan("a", null), plan("b", null)])?.id).toBe("a");
  expect(pickLastOpened([])).toBeUndefined();
});

test("create a plan, switch back, and reopen the last used plan", async ({ page, request }) => {
  const tag = testName("plans");
  const sName = `${tag} S`;
  const aName = `${tag} A`;
  const bName = `${tag} B`;
  // The page sees only this spec's own plans, so other workers cannot change which plan is newest.
  const shown = await showOnlyPlans(page, (p) => p.name.startsWith(tag));
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  const planRe = /\/([0-9a-f-]{36})\/budget$/;

  const created = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: sName },
  });
  expect(created.status()).toBe(201);
  const s = (await created.json()).data.budget as { id: string };
  await page.goto(`/${s.id}/budget`);
  await expect(sidebar.getByRole("button", { name: sName, exact: true })).toBeVisible();

  async function createFrom(fromName: string, name: string) {
    await sidebar.getByRole("button", { name: fromName, exact: true }).click();
    await page.getByRole("menuitem", { name: "New Plan" }).click();
    await page.getByLabel("Plan name").fill(name);
    await page.getByRole("button", { name: "Create Plan" }).click();
    await expect(sidebar.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(page).toHaveURL(planRe);
    return page.url().match(planRe)?.[1] ?? "";
  }
  const idA = await createFrom(sName, aName);
  const idB = await createFrom(aName, bName);
  expect(idB).not.toBe(idA);

  // Open A again through B's menu: Open Plan, then the row for A.
  await sidebar.getByRole("button", { name: bName, exact: true }).click();
  const openPlan = page.getByRole("menuitem", { name: "Open Plan", exact: true });
  await mouseClick(page, openPlan);
  const subMenu = page.getByRole("menu", { name: "Plans" });
  const rowA = subMenu.getByRole("menuitem", { name: aName, exact: true });
  // Move along the Open Plan row into the submenu so the pointer never leaves the two menus.
  const ob = await openPlan.boundingBox();
  const sb = await subMenu.boundingBox();
  await page.mouse.move((sb?.x ?? 0) + 20, (ob?.y ?? 0) + (ob?.height ?? 0) / 2);
  await mouseClick(page, rowA);
  await expect(page).toHaveURL(`/${idA}/budget`);
  await expect(sidebar.getByRole("button", { name: aName, exact: true })).toBeVisible();

  // Opening A is fire-and-forget: wait until A is stamped later than B and B later than S.
  await expect
    .poll(async () => {
      const list = (
        await (await request.get("/api/v1/budgets", { headers: await authHeaders() })).json()
      ).data.budgets;
      const get = (i: string) => list.find((x: { id: string }) => x.id === i)?.last_opened_at ?? "";
      return get(idA) > get(idB) && get(idB) > get(s.id) && get(s.id) !== "";
    })
    .toBe(true);

  const k = shown.served.length;
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/${idA}/budget$`));
  // The first list served to that load: exactly the three plans, A opened last.
  const list = shown.served[k];
  expect(list.map((p) => p.id).sort()).toEqual([s.id, idA, idB].sort());
  const stampA = list.find((p) => p.id === idA)?.last_opened_at ?? "";
  for (const p of list.filter((p) => p.id !== idA))
    expect(stampA > (p.last_opened_at ?? "")).toBe(true);
});
