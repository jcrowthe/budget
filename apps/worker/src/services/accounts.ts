import { type Account, AccountCreate } from "@budget/schema/accounts";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";

export function accountToApi(row: accountsRepo.AccountRow): Account {
  return {
    id: row.id,
    budget_id: row.budgetId,
    name: row.name,
    type: row.type,
    on_budget: row.onBudget,
    note: row.note,
    starred: row.starred,
    closed: row.closed,
    sort: row.sortOrder,
    created_at: row.createdAt,
  };
}

/** Minimal create; EXF-481 extends it. */
export async function createAccount(
  env: Env,
  actor: string,
  input: AccountCreate,
): Promise<Account> {
  const v = AccountCreate.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, v.budget_id))) throw new NotFound("Plan");
  const row: accountsRepo.AccountRow = {
    id: crypto.randomUUID(),
    budgetId: v.budget_id,
    name: v.name,
    type: v.type,
    onBudget: v.on_budget,
    note: v.note ?? null,
    starred: false,
    closed: false,
    sortOrder: (await accountsRepo.maxSort(db, v.budget_id)) + 1,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  await db.batch([
    accountsRepo.insertStmt(db, row),
    changeLogInsert(db, {
      budgetId: row.budgetId,
      actor,
      action: "create",
      entityType: "account",
      entityId: row.id,
      before: null,
      after: accountToApi(row),
    }),
  ]);
  return accountToApi(row);
}
