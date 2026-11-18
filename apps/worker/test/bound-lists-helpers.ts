import { env } from "cloudflare:test";
import { createAccount } from "../src/services/accounts";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { createTransaction } from "../src/services/transactions";
import { actor, plan } from "./category-helpers";

export interface BigGroup {
  bid: string;
  groupId: string;
  targetId: string;
  ids: string[];
}

/** A fresh plan with a group "ZZ-TEST Big" of n categories and, in a second group, a target category.
 *  With `history`, one transaction on the first category. */
export async function seedBigGroup(n: number, opts: { history?: boolean } = {}): Promise<BigGroup> {
  const bid = await plan();
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ-TEST Big" });
  const other = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ-TEST Other" });
  const targetId = (
    await createCategory(env, actor, { budget_id: bid, group_id: other.id, name: "Target" })
  ).id;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(
      (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: `C${i}` })).id,
    );
  }
  if (opts.history) {
    const account = await createAccount(env, actor, {
      budget_id: bid,
      name: "Cash",
      type: "cash",
      on_budget: true,
    });
    await createTransaction(env, actor, {
      budget_id: bid,
      account_id: account.id,
      date: "2026-11-02",
      amount: -1000,
      category_id: ids[0] as string,
      inflow_to_ready_to_assign: false,
    });
  }
  return { bid, groupId: g.id, targetId, ids };
}

/** The rejection's own text, and its cause's, cut short (a Drizzle message holds the whole parameter list); "" if it resolves. */
export async function causeOf(p: () => Promise<unknown>): Promise<string> {
  try {
    await p();
    return "";
  } catch (e) {
    const cut = (x: unknown) => String(x).split("\n")[0]?.slice(0, 60);
    return `${cut(e)} / ${String((e as { cause?: unknown }).cause)}`;
  }
}
