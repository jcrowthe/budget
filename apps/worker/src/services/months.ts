import {
  type MonthDetail as CoreMonthDetail,
  computeMonth,
  computeMonths,
  type EngineInput,
} from "@budget/core/budget-engine";
import { addMonths, type Month } from "@budget/core/month";
import {
  AssignedSet,
  MoneyMove,
  type MonthCategory,
  type MonthDetail,
  MonthNoteSet,
  type MonthSummary,
} from "@budget/schema/months";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { type ChangeLogEntry, changeLogInsert } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as groupsRepo from "../repositories/category-groups";
import * as monthCatRepo from "../repositories/month-categories";
import * as monthsRepo from "../repositories/months";
import * as txRepo from "../repositories/transactions";

// Type-level check: the engine's read model and the API schema are the same shape, both ways.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _sameShape: Same<CoreMonthDetail, MonthDetail> = true;
void _sameShape;

async function requirePlan(db: Db, budgetId: string) {
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
}

const mcEntityId = (categoryId: string, month: string) => `${categoryId}:${month}`;

/** Test seam: builds the setAssigned batch with a custom change_log entry (to prove atomicity). */
export function buildSetAssignedBatch(
  db: Db,
  row: monthCatRepo.MonthCategoryRow,
  log: ChangeLogEntry,
) {
  return [monthCatRepo.setStmt(db, row), changeLogInsert(db, log)] as const;
}

export async function setAssigned(
  env: Env,
  actor: string,
  input: AssignedSet,
): Promise<MonthCategory> {
  const v = AssignedSet.parse(input);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  if (!(await categoriesRepo.findActive(db, v.budget_id, v.category_id))) {
    throw new NotFound("Category");
  }
  const before = await monthCatRepo.find(db, v.budget_id, v.month, v.category_id);
  const row: monthCatRepo.MonthCategoryRow = {
    budgetId: v.budget_id,
    month: v.month,
    categoryId: v.category_id,
    assigned: v.assigned,
    updatedAt: new Date().toISOString(),
  };
  const result: MonthCategory = {
    month: v.month,
    category_id: v.category_id,
    assigned: v.assigned,
  };
  await db.batch([
    ...buildSetAssignedBatch(db, row, {
      budgetId: v.budget_id,
      actor,
      action: "update",
      entityType: "month_category",
      entityId: mcEntityId(v.category_id, v.month),
      before: { month: v.month, category_id: v.category_id, assigned: before?.assigned ?? 0 },
      after: result,
    }),
  ]);
  return result;
}

/**
 * Moves `amount` of Assigned in a month from one category to another. A null side is Ready to Assign: only the
 * other category's Assigned changes. One batch: the upserts add a delta, so concurrent moves never lose one.
 */
export async function moveMoney(
  env: Env,
  actor: string,
  input: MoneyMove,
): Promise<MonthCategory[]> {
  const v = MoneyMove.parse(input);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  const sides = [
    { id: v.from_category_id, delta: -v.amount },
    { id: v.to_category_id, delta: v.amount },
  ].filter((s): s is { id: string; delta: number } => s.id !== null);
  const now = new Date().toISOString();
  const stmts = [];
  const out: MonthCategory[] = [];
  for (const s of sides) {
    if (!(await categoriesRepo.findActive(db, v.budget_id, s.id))) throw new NotFound("Category");
    const before = (await monthCatRepo.find(db, v.budget_id, v.month, s.id))?.assigned ?? 0;
    const after = { month: v.month, category_id: s.id, assigned: before + s.delta };
    out.push(after);
    stmts.push(
      monthCatRepo.addStmt(db, {
        budgetId: v.budget_id,
        month: v.month,
        categoryId: s.id,
        delta: s.delta,
        updatedAt: now,
      }),
      changeLogInsert(db, {
        budgetId: v.budget_id,
        actor,
        action: "update",
        entityType: "month_category",
        entityId: mcEntityId(s.id, v.month),
        before: { month: v.month, category_id: s.id, assigned: before },
        after: {
          ...after,
          move: {
            from_category_id: v.from_category_id,
            to_category_id: v.to_category_id,
            amount: v.amount,
          },
        },
      }),
    );
  }
  await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  return out;
}

export async function setMonthNote(
  env: Env,
  actor: string,
  input: MonthNoteSet,
): Promise<{ month: string; note: string | null }> {
  const v = MonthNoteSet.parse(input);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  const before = await monthsRepo.find(db, v.budget_id, v.month);
  await db.batch([
    monthsRepo.upsertNoteStmt(db, {
      budgetId: v.budget_id,
      month: v.month,
      note: v.note,
      updatedAt: new Date().toISOString(),
    }),
    changeLogInsert(db, {
      budgetId: v.budget_id,
      actor,
      action: "update",
      entityType: "month",
      entityId: v.month,
      before: { month: v.month, note: before?.note ?? null },
      after: { month: v.month, note: v.note },
    }),
  ]);
  return { month: v.month, note: v.note };
}

async function loadInput(db: Db, budgetId: string, activityBefore: string): Promise<EngineInput> {
  const [groups, categories, assignments, notes, activity] = await Promise.all([
    groupsRepo.listActive(db, budgetId),
    categoriesRepo.listActive(db, budgetId),
    monthCatRepo.listForBudget(db, budgetId),
    monthsRepo.listNotes(db, budgetId),
    txRepo.activityByMonth(db, budgetId, activityBefore),
  ]);
  return {
    groups,
    categories,
    assignments: assignments.map((a) => ({
      categoryId: a.categoryId,
      month: a.month,
      assigned: a.assigned,
    })),
    activity,
    notes: notes.map((n) => ({ month: n.month, note: n.note })),
  };
}

export async function getPlanMonth(env: Env, budgetId: string, month: Month): Promise<MonthDetail> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  return computeMonth(await loadInput(db, budgetId, addMonths(month, 1)), month);
}

export async function listPlanMonths(
  env: Env,
  budgetId: string,
  from: Month,
  to: Month,
): Promise<MonthSummary[]> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  return computeMonths(await loadInput(db, budgetId, addMonths(to, 1)), from, to);
}
