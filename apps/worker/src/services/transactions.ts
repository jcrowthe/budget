import { type Transaction, TransactionCreate } from "@budget/schema/transactions";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as txRepo from "../repositories/transactions";

export function transactionToApi(row: txRepo.TransactionRow): Transaction {
  return {
    id: row.id,
    budget_id: row.budgetId,
    account_id: row.accountId,
    date: row.date,
    payee_name: row.payeeName,
    category_id: row.categoryId,
    inflow_to_ready_to_assign: row.inflowToReadyToAssign,
    memo: row.memo,
    amount: row.amount,
    cleared: row.cleared,
    approved: row.approved,
    created_at: row.createdAt,
  };
}

/** Minimal create; the register tickets extend it. */
export async function createTransaction(
  env: Env,
  actor: string,
  input: TransactionCreate,
): Promise<Transaction> {
  const v = TransactionCreate.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, v.budget_id))) throw new NotFound("Plan");
  if (!(await accountsRepo.findActive(db, v.budget_id, v.account_id)))
    throw new NotFound("Account");
  if (v.category_id && !(await categoriesRepo.findActive(db, v.budget_id, v.category_id))) {
    throw new NotFound("Category");
  }
  const row: txRepo.TransactionRow = {
    id: crypto.randomUUID(),
    budgetId: v.budget_id,
    accountId: v.account_id,
    date: v.date,
    payeeName: v.payee_name ?? null,
    categoryId: v.category_id ?? null,
    inflowToReadyToAssign: v.inflow_to_ready_to_assign,
    memo: v.memo ?? null,
    amount: v.amount,
    cleared: v.cleared,
    approved: v.approved,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  await db.batch([
    txRepo.insertStmt(db, row),
    changeLogInsert(db, {
      budgetId: row.budgetId,
      actor,
      action: "create",
      entityType: "transaction",
      entityId: row.id,
      before: null,
      after: transactionToApi(row),
    }),
  ]);
  return transactionToApi(row);
}
