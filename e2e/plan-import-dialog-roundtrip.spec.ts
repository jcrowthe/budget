import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { seedCard } from "./support/card-seed";
import { chooseFiles, openImport } from "./support/plan-import-dialog-files";
import { monthIso } from "./support/plan-seed";
import { realClick } from "./support/real-click";
import { createSched } from "./support/scheduled-seed";

test.use({ viewport: { width: 1440, height: 900 } });

const dialog = (page: Page) => page.getByRole("dialog", { name: "Import Plan", exact: true });
const pad = (n: number) => String(n).padStart(2, "0");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function api(request: APIRequestContext, method: string, path: string, data?: unknown) {
  const res = await request.fetch(`/api/v1/budgets${path}`, {
    method,
    headers: await authHeaders(),
    data,
  });
  expect(res.ok(), `${method} ${path} -> ${res.status()}`).toBe(true);
  return (await res.json()).data;
}

/** The figures the two plans must share, read by the API. */
async function figures(request: APIRequestContext, plan: string) {
  const month = await api(request, "GET", `/${plan}/months/${monthIso(0)}`);
  const cats = month.groups.flatMap(
    (g: { categories: { name: string; available: number }[] }) => g.categories,
  ) as { name: string; available: number }[];
  const accounts = (await api(request, "GET", `/${plan}/accounts`)).accounts as {
    name: string;
    balance: number;
  }[];
  return {
    ready: month.ready_to_assign as number,
    groceries: cats.find((c) => c.name === "ZZ Groceries")?.available,
    visa: accounts.find((a) => a.name === "ZZ-TEST Visa")?.balance,
  };
}

test("13 the round trip through both screens: the new plan has the first plan's figures", async ({
  page,
  request,
}) => {
  const seed = await seedCard(request);
  const name = testName("rt");
  const ids: string[] = [seed.plan];
  try {
    const { plan } = seed;
    const groupId = (
      (await api(request, "GET", `/${plan}/months/${monthIso(0)}`)).groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === "ZZ Spending")?.id;
    const fun = (
      await api(request, "POST", `/${plan}/categories`, {
        group_id: groupId,
        name: "ZZ Fun",
      })
    ).category.id as string;
    const old = (
      await api(request, "POST", `/${plan}/categories`, {
        group_id: groupId,
        name: "ZZ Old",
      })
    ).category.id as string;
    // A split, a transfer (days after the 12th, so the file's dates are clear), a scheduled row, a hidden category.
    await api(request, "POST", `/${plan}/transactions`, {
      account_id: seed.checking,
      date: "2026-11-14",
      amount: -10000,
      payee_name: "ZZ Split Shop",
      subtransactions: [
        { amount: -6000, category_id: seed.groceries },
        { amount: -4000, category_id: fun },
      ],
    });
    await api(request, "POST", `/${plan}/transactions`, {
      account_id: seed.checking,
      date: "2026-11-15",
      amount: -20000,
      transfer_account_id: seed.savings,
    });
    const next = new Date();
    next.setMonth(next.getMonth() + 1, 5);
    await createSched(request, plan, localToday(), {
      account_id: seed.checking,
      date_first: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-05`,
      frequency: "monthly",
      amount: -5000,
      payee_name: "ZZ Rent",
    });
    await api(request, "PATCH", `/${plan}/categories/${old}`, { hidden: true });
    const first = await figures(request, plan);

    // Export with the dialog, then import that very zip with the dialog.
    await page.goto(`/${plan}/budget`);
    await realClick(page, page.locator(".plan-button"));
    await realClick(page, page.getByRole("menuitem", { name: "Export Plan", exact: true }));
    const waiting = page.waitForEvent("download");
    await realClick(
      page,
      page
        .getByRole("dialog", { name: "Export Plan" })
        .getByRole("button", { name: "Export", exact: true }),
    );
    const download = await waiting;
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile((await download.path()) as string);
    const rtaText = async () => (await page.locator(".rta-amount").first().textContent()) ?? "";
    await expect.poll(rtaText).not.toBe("");
    const firstText = await rtaText();

    await openImport(page);
    await chooseFiles(page, [
      { name: download.suggestedFilename(), mimeType: "application/zip", buffer },
    ]);
    const d = dialog(page);
    await expect(d.getByRole("radio")).toHaveCount(0);
    await d.getByLabel("Plan name", { exact: true }).fill(name);
    await expect(d.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await realClick(page, d.getByRole("button", { name: "Import", exact: true }));
    await expect(d.getByText(`Imported ${name}.`, { exact: true })).toBeVisible();
    await realClick(page, d.getByRole("button", { name: "Open Plan", exact: true }));
    await expect(page).toHaveURL(/\/[^/]+\/budget$/);
    const copy = page.url().split("/").slice(-2)[0] as string;
    ids.push(copy);
    expect(copy).not.toBe(plan);

    const second = await figures(request, copy);
    expect(second).toEqual(first);
    await expect.poll(rtaText).toBe(firstText);
  } finally {
    for (const id of ids)
      await request.delete(`/api/v1/budgets/${id}`, { headers: await authHeaders() });
  }
});
