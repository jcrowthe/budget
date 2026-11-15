import type { Budget, BudgetCreate, BudgetUpdate } from "@budget/schema/budgets";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { type ChangeLogEntry, changeLogInsert } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as repo from "../repositories/budgets";

export function toApi(row: repo.BudgetRow): Budget {
  return {
    id: row.id,
    name: row.name,
    created_at: row.createdAt,
    last_modified_on: row.updatedAt,
  };
}

export async function listBudgets(env: Env): Promise<Budget[]> {
  return (await repo.listActive(getDb(env))).map(toApi);
}

export async function getBudget(env: Env, id: string): Promise<Budget> {
  const row = await repo.findActive(getDb(env), id);
  if (!row) throw new NotFound("Plan");
  return toApi(row);
}

/** Test seam: builds the create batch with a custom change_log entry (to prove atomicity). */
export function buildCreateBatch(db: Db, row: repo.BudgetRow, log: ChangeLogEntry) {
  return [repo.insertStmt(db, row), changeLogInsert(db, log)] as const;
}

export async function createBudget(env: Env, actor: string, input: BudgetCreate): Promise<Budget> {
  const db = getDb(env);
  const now = new Date().toISOString();
  const row: repo.BudgetRow = {
    id: crypto.randomUUID(),
    name: input.name,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const batch = buildCreateBatch(db, row, {
    budgetId: row.id,
    actor,
    action: "create",
    entityType: "budget",
    entityId: row.id,
    before: null,
    after: toApi(row),
  });
  await db.batch([...batch]);
  return toApi(row);
}

export async function updateBudget(
  env: Env,
  actor: string,
  id: string,
  patch: BudgetUpdate,
): Promise<Budget> {
  const db = getDb(env);
  const before = await repo.findActive(db, id);
  if (!before) throw new NotFound("Plan");
  const now = new Date().toISOString();
  const after = {
    ...before,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    updatedAt: now,
  };
  await db.batch([
    repo.updateStmt(db, id, patch.name === undefined ? {} : { name: patch.name }, now),
    changeLogInsert(db, {
      budgetId: id,
      actor,
      action: "update",
      entityType: "budget",
      entityId: id,
      before: toApi(before),
      after: toApi(after),
    }),
  ]);
  return toApi(after);
}

export async function deleteBudget(env: Env, actor: string, id: string): Promise<void> {
  const db = getDb(env);
  const before = await repo.findActive(db, id);
  if (!before) throw new NotFound("Plan");
  await db.batch([
    repo.softDeleteStmt(db, id, new Date().toISOString()),
    changeLogInsert(db, {
      budgetId: id,
      actor,
      action: "delete",
      entityType: "budget",
      entityId: id,
      before: toApi(before),
      after: null,
    }),
  ]);
}
