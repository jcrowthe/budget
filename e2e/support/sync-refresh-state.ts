import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { fakeBankAccount, stubBankLink } from "./bank-link-stub";
import { addAccount, newPlan, sidebar, zzBank } from "./manage-connections-seed";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

/** The bank now lists ZZ Rewards, which the connection has no row for; opening the plan sends its one sync. */
export async function refreshState(
  page: Page,
  request: APIRequestContext,
  over: Parameters<typeof zzBank>[0] = {},
  missing = false,
) {
  const z = zzBank({ status: "connected", last_synced_at: null, ...over });
  const rewards = fakeBankAccount({
    name: "ZZ Rewards",
    mask: "4321",
    type: "credit",
    subtype: "credit card",
    plan_type: "creditCard",
  });
  const plan = await newPlan(request);
  const linked = await addAccount(request, plan, "ZZ Linked", "checking");
  const stub = await stubBankLink(page, request, {
    budgetId: plan,
    connections: [z.connection],
    links: { [linked]: z.checking.id },
    missing: missing ? { [linked]: hoursAgo(2) } : {},
    bankAdds: { [z.connection.id]: [rewards] },
  });
  await page.goto(`/${plan}/budget`);
  await expect(sidebar(page).getByRole("link", { name: /ZZ Linked/ })).toBeVisible();
  return { z, rewards, plan, linked, stub };
}

export const syncs = (s: { stub: { requests: { method: string; url: string }[] } }) =>
  s.stub.requests.filter((r) => r.method === "POST" && /\/budgets\/[^/]+\/sync$/.test(r.url));
