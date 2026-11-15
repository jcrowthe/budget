import type { Budget, BudgetCreate, BudgetUpdate } from "@budget/schema/budgets";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { type ChangeLogEntry, changeLogInsert, changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as repo from "../repositories/budgets";
import { defaultCategoryStmts } from "./default-categories";

export function toApi(row: repo.BudgetRow): Budget {
  return {
    id: row.id,
    name: row.name,
    created_at: row.createdAt,
    last_modified_on: row.updatedAt,
    last_opened_at: row.lastOpenedAt ?? null,
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
    lastOpenedAt: null,
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
  await db.batch([...batch, ...defaultCategoryStmts(db, row.id, actor, now)]);
  return toApi(row);
}

/** After a guarded batch changed 0 rows: the plan is gone (404) or was modified by someone else (409). */
async function lostRace(db: Db, id: string): Promise<never> {
  if (await repo.findActive(db, id)) throw new Conflict("Plan");
  throw new NotFound("Plan");
}

/**
 * Mutations on an existing row: the change_log insert comes FIRST and the UPDATE second, both guarded by
 * "the row is still exactly what was read". A lost race therefore writes neither, and the log never
 * records a change that did not happen.
 */
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
  // Opening a plan is not a change: no change_log, no last_modified_on bump (EXF-475).
  if (patch.opened === true && patch.name === undefined) {
    const res = await repo.markOpenedStmt(db, id, now);
    if (res.meta.changes === 0) throw new NotFound("Plan");
    return toApi({ ...before, lastOpenedAt: now });
  }
  const lastOpenedAt = patch.opened === true ? now : undefined;
  const after = {
    ...before,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
    updatedAt: now,
  };
  const [, result] = await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId: id,
        actor,
        action: "update",
        entityType: "budget",
        entityId: id,
        before: toApi(before),
        after: toApi(after),
      },
      repo.existsUnchanged(db, before),
    ),
    repo.updateStmt(
      db,
      before,
      {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
      },
      now,
    ),
  ]);
  if (result.meta.changes === 0) return lostRace(db, id);
  return toApi(after);
}

export async function deleteBudget(env: Env, actor: string, id: string): Promise<void> {
  const db = getDb(env);
  const before = await repo.findActive(db, id);
  if (!before) throw new NotFound("Plan");
  const [, result] = await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId: id,
        actor,
        action: "delete",
        entityType: "budget",
        entityId: id,
        before: toApi(before),
        after: null,
      },
      repo.existsUnchanged(db, before),
    ),
    repo.softDeleteStmt(db, before, new Date().toISOString()),
  ]);
  if (result.meta.changes === 0) await lostRace(db, id);
}
