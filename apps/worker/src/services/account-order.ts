import { accountGroup } from "@budget/core/account-types";
import { type Account, AccountOrderRequest } from "@budget/schema/accounts";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { Conflict, NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import { type LogBase, logSelectStmt } from "../repositories/guards";
import { AccountRefused, accountList } from "./accounts";

const MAX_ATTEMPTS = 5;

export const ACCOUNT_CLOSED_ORDER = "A closed account can't be reordered.";
export const ACCOUNT_GROUPS_MIXED =
  "Accounts can only be reordered within one group (cash, credit, loans or tracking).";

export type OrderPlan = { entries: accountsRepo.AccountOrderEntry[]; renumber: boolean };

/**
 * The sort values for a reorder. `rows` is the plan's non-deleted accounts in display order, `ids` the listed
 * accounts in their new order (all in `rows`). Normally the listed accounts take their own sort values back in
 * the new order (slots ascending), so nothing else moves and the plan's max does not change. When two accounts
 * share a value (never made by the app) the whole plan is renumbered 0..n-1 in the new display order. Returns
 * null when the listed accounts are already in that order. Entries cover every listed account and every other
 * account that is written (`w` = 1 only where the value changes).
 */
export function planAccountOrder(
  rows: readonly accountsRepo.OrderRow[],
  ids: readonly string[],
): OrderPlan | null {
  const listed = new Set(ids);
  const current = rows.filter((r) => listed.has(r.id));
  if (current.every((r, i) => r.id === ids[i])) return null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const slots = current.map((r) => r.sortOrder).sort((a, b) => a - b);
  const others = new Set(rows.filter((r) => !listed.has(r.id)).map((r) => r.sortOrder));
  const distinct = new Set(slots).size === slots.length && slots.every((v) => !others.has(v));
  const entry = (r: accountsRepo.OrderRow, n: number, l: 0 | 1) => ({
    i: r.id,
    o: r.sortOrder,
    n,
    t: r.type,
    l,
    w: (n !== r.sortOrder ? 1 : 0) as 0 | 1,
  });
  if (distinct) {
    return {
      entries: ids.map((id, k) =>
        entry(byId.get(id) as accountsRepo.OrderRow, slots[k] as number, 1),
      ),
      renumber: false,
    };
  }
  // the listed accounts fill the positions the listed ones held, in the new order
  let k = 0;
  const next = rows.map((r) => (listed.has(r.id) ? (byId.get(ids[k++] as string) as typeof r) : r));
  return {
    entries: next
      .map((r, pos) => entry(r, pos, listed.has(r.id) ? 1 : 0))
      .filter((e) => e.l === 1 || e.w === 1),
    renumber: true,
  };
}

/**
 * Puts one sidebar section's open accounts in a new order (a subset reorders only those). One batch: change_log
 * rows (`update`/`account`, before and after `sort`) and the sort update, both behind one guard. Unknown ids are
 * 404; a closed account or ids from more than one group are 422, with nothing written.
 */
export async function reorderAccounts(
  env: Env,
  actor: string,
  input: { budget_id: string; account_ids: string[] },
): Promise<Account[]> {
  const v = AccountOrderRequest.parse({ account_ids: input.account_ids });
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, input.budget_id))) throw new NotFound("Plan");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await accountsRepo.listForOrder(db, input.budget_id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const listed = v.account_ids.map((id) => byId.get(id));
    if (listed.some((r) => !r)) throw new NotFound("Account");
    const open = listed as accountsRepo.OrderRow[];
    if (open.some((r) => r.closed))
      throw new AccountRefused(ACCOUNT_CLOSED_ORDER, 422, "account_closed");
    if (new Set(open.map((r) => accountGroup(r.type))).size > 1) {
      throw new AccountRefused(ACCOUNT_GROUPS_MIXED, 422, "account_groups_mixed");
    }
    const plan = planAccountOrder(rows, v.account_ids);
    if (!plan) return accountList(db, input.budget_id, true);
    const json = JSON.stringify(plan.entries);
    const guard = accountsRepo.orderGuard(
      input.budget_id,
      json,
      plan.renumber ? rows.length : null,
    );
    const base: LogBase = {
      budgetId: input.budget_id,
      actor,
      action: "update",
      entityType: "account",
      createdAt: new Date().toISOString(),
    };
    const [, result] = await db.batch([
      logSelectStmt(db, base, accountsRepo.orderInner(input.budget_id, json, guard), {
        entityId: sql`id`,
        before: accountsRepo.orderBeforeJson(),
        after: accountsRepo.orderAfterJson(),
      }),
      accountsRepo.orderSortsStmt(db, input.budget_id, json, guard),
    ]);
    if (result.meta.changes > 0) return accountList(db, input.budget_id, true);
  }
  throw new Conflict("Account order");
}
