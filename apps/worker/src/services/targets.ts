import { toMonth } from "@budget/core/month";
import { IsoDate } from "@budget/schema/common/dates";
import { type Target, TargetDelete, TargetSet } from "@budget/schema/targets";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { type ChangeLogEntry, changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as repo from "../repositories/targets";

const MAX_ATTEMPTS = 5;

/** Today's date in UTC, the same rule `currentMonth()` uses. */
export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

export function targetToApi(row: repo.TargetRow): Target {
  return {
    ...repo.toDefinition(row),
    budget_id: row.budgetId,
    category_id: row.categoryId,
    created_month: toMonth(row.createdOn),
  };
}

/** Test seam: the setTarget batch with a custom change_log entry (to prove atomicity). */
export function buildSetTargetBatch(
  db: Db,
  row: repo.TargetRow,
  log: ChangeLogEntry,
  beforeUpdatedAt?: string,
) {
  return [
    changeLogInsertIf(db, log, repo.holds(db, row.budgetId, row.categoryId, beforeUpdatedAt)),
    repo.upsertIfHoldsStmt(db, row, beforeUpdatedAt),
  ] as const;
}

async function requirePlan(db: Db, budgetId: string) {
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
}

/** Creates or replaces a category's target. A replace keeps `created_on`. */
export async function setTarget(
  env: Env,
  actor: string,
  input: TargetSet,
  opts: { today?: string } = {},
): Promise<Target> {
  const v = TargetSet.parse(input);
  const today = opts.today === undefined ? undefined : IsoDate.parse(opts.today);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  if (!(await categoriesRepo.findActive(db, v.budget_id, v.category_id))) {
    throw new NotFound("Category");
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await repo.find(db, v.budget_id, v.category_id);
    const now = new Date().toISOString();
    const row: repo.TargetRow = {
      categoryId: v.category_id,
      budgetId: v.budget_id,
      cadence: v.cadence,
      behavior: v.behavior,
      amount: v.amount,
      dayOfWeek: v.day_of_week ?? null,
      dayOfMonth: v.day_of_month ?? null,
      dueDate: v.due_date ?? null,
      dueMonth: v.due_month ?? null,
      repeatEvery: v.repeat?.every ?? null,
      repeatUnit: v.repeat?.unit ?? null,
      createdOn: before?.createdOn ?? today ?? todayUtc(),
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    };
    const result = targetToApi(row);
    const [, write] = await db.batch([
      ...buildSetTargetBatch(
        db,
        row,
        {
          budgetId: v.budget_id,
          actor,
          action: before ? "update" : "create",
          entityType: "target",
          entityId: v.category_id,
          before: before ? targetToApi(before) : null,
          after: result,
        },
        before?.updatedAt,
      ),
    ]);
    if (write.meta.changes > 0) return result;
  }
  throw new Conflict("Target");
}

export async function deleteTarget(env: Env, actor: string, input: TargetDelete): Promise<void> {
  const v = TargetDelete.parse(input);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await repo.find(db, v.budget_id, v.category_id);
    if (!before) throw new NotFound("Target");
    const [, del] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId: v.budget_id,
          actor,
          action: "delete",
          entityType: "target",
          entityId: v.category_id,
          before: targetToApi(before),
          after: null,
        },
        repo.holds(db, v.budget_id, v.category_id, before.updatedAt),
      ),
      repo.deleteIfHoldsStmt(db, v.budget_id, v.category_id, before.updatedAt),
    ]);
    if (del.meta.changes > 0) return;
  }
  throw new Conflict("Target");
}
