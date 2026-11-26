import type { CategoryDeleted, CategoryUsage } from "@budget/schema/categories";
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { type Db, getDb } from "../db/client";
import { targets } from "../db/schema/targets";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as groupsRepo from "../repositories/category-groups";
import * as reassignRepo from "../repositories/category-reassign";
import { allOf, idList, type LogBase, whenQuery } from "../repositories/guards";
import * as monthCatsRepo from "../repositories/month-categories";
import * as scheduledRepo from "../repositories/scheduled-transactions";
import * as targetsRepo from "../repositories/targets";
import { categoryToApi, groupToApi, HistoryExists, InvalidReassignTarget } from "./categories";
import { PaymentLocked } from "./credit-payments";
import { targetToApi } from "./targets";

const MAX_ATTEMPTS = 5;
const isUuid = (s: string) => z.uuid().safeParse(s).success;

export interface DeletePlan {
  budgetId: string;
  actor: string;
  now: string;
  categoryIds: string[];
  group: groupsRepo.CategoryGroupRow | null;
  categories: categoriesRepo.CategoryRow[];
  targetId: string | null;
  targets: targetsRepo.TargetRow[];
  /** Live schedules in the deleted categories: moved to the target, or cleared when there is none. */
  schedules?: number;
  /** Where a loan paired with a deleted category goes: the validated `reassign_to`, even with nothing else to move; null clears it. */
  pairTo?: string | null;
}

/**
 * The statements of one delete, in order (rules R6/R7). Every statement carries the same guard, so a race
 * that changed anything makes all of them no-ops; the last statement's `changes()` says whether it applied.
 * A test appends a failing statement to prove the batch is atomic.
 */
export function buildDeleteBatch(db: Db, p: DeletePlan): BatchItem<"sqlite">[] {
  const { budgetId, categoryIds: ids, targetId } = p;
  const withHistory = targetId !== null;
  // Parts of the guard.
  const hist = withHistory ? null : categoriesRepo.noHistory(budgetId, ids);
  const target = targetId ? categoriesRepo.activeInActiveGroup(budgetId, targetId) : null;
  const cats = ids.length > 0 ? categoriesRepo.allActive(ids) : null;
  const groupActive = p.group
    ? sql`exists (select 1 from category_groups where id = ${p.group.id} and deleted_at is null)`
    : null;
  // The group's active categories must be exactly the listed ones: one added since the read would be orphaned.
  const groupExact = p.group
    ? sql`(select count(*) from categories where group_id = ${p.group.id} and deleted_at is null) = ${ids.length}`
    : null;
  // Nothing before the final statements changes any part of this guard, so it holds for all of them.
  const full = allOf(hist, target, cats, groupActive, groupExact);
  // The group goes only if this batch's categories were soft-deleted (deleted_at = now, no wall clock involved),
  // none is left active in it, and the rest of the guard still holds.
  const groupGo = p.group
    ? allOf(
        hist,
        target,
        groupActive,
        sql`(select count(*) from categories where id in (${idList(ids)}) and deleted_at = ${p.now}) = ${ids.length}`,
        sql`not exists (select 1 from categories where group_id = ${p.group.id} and deleted_at is null)`,
      )
    : null;
  const log = (entityType: string, action: LogBase["action"] = "delete"): LogBase => ({
    budgetId,
    actor: p.actor,
    action,
    entityType,
    createdAt: p.now,
  });
  const stmts: BatchItem<"sqlite">[] = [];
  if (targetId) {
    stmts.push(
      reassignRepo.logMovesStmt(db, log("transaction", "update"), budgetId, ids, targetId, full),
      reassignRepo.moveTransactionsStmt(db, budgetId, ids, targetId, p.now, full),
      monthCatsRepo.logMergeStmt(
        db,
        log("month_category", "update"),
        budgetId,
        ids,
        targetId,
        full,
      ),
      monthCatsRepo.mergeIntoStmt(db, budgetId, ids, targetId, p.now, full),
    );
  }
  if ((p.schedules ?? 0) > 0) {
    stmts.push(
      scheduledRepo.logCategoryChangeStmt(
        db,
        { ...log("scheduled_transaction", "update") },
        budgetId,
        ids,
        targetId,
        full,
      ),
      scheduledRepo.changeCategoryStmt(db, budgetId, ids, targetId, p.now, full),
      // The lines of split schedules: logged, the parents' tokens renewed, then moved.
      scheduledRepo.logLineCategoryChangeStmt(
        db,
        { ...log("scheduled_subtransaction", "update") },
        budgetId,
        ids,
        targetId,
        full,
      ),
      scheduledRepo.renewTokenOfLinesStmt(db, budgetId, ids, full),
      scheduledRepo.changeLineCategoryStmt(db, budgetId, ids, targetId, p.now, full),
    );
  }
  // Loans paired with a deleted category: always present (no read), a no-op when none is paired.
  const pairTo = p.pairTo ?? null;
  stmts.push(
    accountsRepo.logPairingChangeStmt(db, log("account", "update"), budgetId, ids, pairTo, full),
    accountsRepo.changePairingStmt(db, budgetId, ids, pairTo, full),
  );
  for (const t of p.targets) {
    stmts.push(
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor: p.actor,
          action: "delete",
          entityType: "target",
          entityId: t.categoryId,
          before: targetToApi(t),
          after: null,
        },
        whenQuery(db, full),
      ),
    );
  }
  if (p.targets.length > 0) {
    stmts.push(
      db
        .delete(targets)
        .where(
          sql`${targets.budgetId} = ${budgetId} and ${targets.categoryId} in (${idList(
            p.targets.map((t) => t.categoryId),
          )}) and ${full}`,
        ),
    );
  }
  for (const c of p.categories) {
    stmts.push(
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor: p.actor,
          action: "delete",
          entityType: "category",
          entityId: c.id,
          before: categoryToApi(c),
          after: null,
        },
        whenQuery(db, full),
      ),
    );
  }
  if (p.group) {
    stmts.push(
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor: p.actor,
          action: "delete",
          entityType: "category_group",
          entityId: p.group.id,
          before: groupToApi(p.group),
          after: null,
        },
        whenQuery(db, full),
      ),
    );
  }
  stmts.push(categoriesRepo.softDeleteManyStmt(db, ids, p.now, full));
  if (p.group && groupGo) stmts.push(groupsRepo.softDeleteStmt(db, p.group.id, p.now, groupGo));
  return stmts;
}

/** The schedule update's row count: it follows its log statement and any transaction/month statements. */
function scheduleChanges(results: { meta: { changes: number } }[], p: DeletePlan): number {
  const at = (p.targetId ? 4 : 0) + 1;
  return results[at]?.meta.changes ?? 0;
}

async function requirePlan(db: Db, budgetId: string) {
  if (!isUuid(budgetId) || !(await budgetsRepo.findActive(db, budgetId)))
    throw new NotFound("Plan");
}

export async function categoryUsage(
  env: Env,
  budgetId: string,
  categoryId: string,
): Promise<CategoryUsage> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  if (!isUuid(categoryId) || !(await categoriesRepo.findActive(db, budgetId, categoryId))) {
    throw new NotFound("Category");
  }
  return usageOf(db, budgetId, [categoryId]);
}

export async function groupUsage(
  env: Env,
  budgetId: string,
  groupId: string,
): Promise<CategoryUsage> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  if (!isUuid(groupId) || !(await groupsRepo.findActive(db, budgetId, groupId))) {
    throw new NotFound("Category group");
  }
  const cats = await categoriesRepo.listActiveInGroup(db, groupId);
  return usageOf(
    db,
    budgetId,
    cats.map((c) => c.id),
  );
}

async function usageOf(db: Db, budgetId: string, ids: string[]): Promise<CategoryUsage> {
  const h = await categoriesRepo.historyOf(db, budgetId, ids);
  return {
    category_count: ids.length,
    scheduled_count: h.schedules,
    transaction_count: h.transactions,
    has_assigned: h.assignedMonths > 0,
    has_history: h.transactions > 0 || h.assignedMonths > 0,
  };
}

function historyMessage(what: string, h: { transactions: number; assignedMonths: number }) {
  const parts: string[] = [];
  if (h.transactions > 0)
    parts.push(`${h.transactions} transaction${h.transactions === 1 ? "" : "s"}`);
  if (h.assignedMonths > 0) parts.push("assigned amounts");
  return `${what} has history (${parts.join(", ")}); pass reassign_to`;
}

/** The target must be an active category of the plan, in an active group, outside the deleted ones. */
async function checkTarget(
  db: Db,
  budgetId: string,
  reassignTo: string,
  deleting: string[],
): Promise<string> {
  const bad = (m: string) => new InvalidReassignTarget(`reassign_to ${m}`);
  if (!isUuid(reassignTo)) throw bad("is not a category of this plan");
  if (deleting.includes(reassignTo)) throw bad("is a category being deleted");
  const target = await categoriesRepo.findActive(db, budgetId, reassignTo);
  if (!target) throw bad("is not an active category of this plan");
  if (target.kind !== null) throw bad("is a credit card payment category");
  return reassignTo;
}

async function run(
  env: Env,
  actor: string,
  budgetId: string,
  opts: { categoryId?: string; groupId?: string; reassignTo?: string },
): Promise<CategoryDeleted> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let group: groupsRepo.CategoryGroupRow | null = null;
    let cats: categoriesRepo.CategoryRow[];
    if (opts.groupId !== undefined) {
      const g = isUuid(opts.groupId)
        ? await groupsRepo.findActive(db, budgetId, opts.groupId)
        : undefined;
      if (!g) throw new NotFound("Category group");
      if (g.kind !== null) throw new PaymentLocked("payment_group_locked");
      group = g;
      cats = await categoriesRepo.listActiveInGroup(db, g.id);
    } else {
      const c = isUuid(opts.categoryId ?? "")
        ? await categoriesRepo.findActive(db, budgetId, opts.categoryId as string)
        : undefined;
      if (!c) throw new NotFound("Category");
      if (c.kind !== null) throw new PaymentLocked("payment_category_locked");
      cats = [c];
    }
    const ids = cats.map((c) => c.id);
    const targetId =
      opts.reassignTo !== undefined ? await checkTarget(db, budgetId, opts.reassignTo, ids) : null;
    const history = await categoriesRepo.historyOf(db, budgetId, ids);
    const hasHistory = history.transactions > 0 || history.assignedMonths > 0;
    if (hasHistory && targetId === null) {
      throw new HistoryExists(historyMessage(group ? "Category group" : "Category", history));
    }
    const schedules = history.schedules;
    // A target with nothing to move is accepted but not used: the plain delete has the stronger guard.
    const useTarget = hasHistory || schedules > 0 ? targetId : null;
    const months = useTarget ? await monthCatsRepo.mergeableMonths(db, budgetId, ids) : 0;
    const allTargets = await targetsRepo.listForBudget(db, budgetId);
    const plan: DeletePlan = {
      budgetId,
      actor,
      now: new Date().toISOString(),
      categoryIds: ids,
      group,
      categories: cats,
      targetId: useTarget,
      targets: allTargets.filter((t) => ids.includes(t.categoryId)),
      schedules,
      pairTo: targetId,
    };
    const results = await db.batch(
      buildDeleteBatch(db, plan) as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    const applied = results[results.length - 1].meta.changes > 0;
    // An empty group deletes no category, so its own soft-delete is the last statement (and the one that counts).
    if (applied) {
      return {
        category_ids: ids,
        group_id: group?.id ?? null,
        reassigned_to: useTarget,
        transactions_moved: useTarget ? (results[1]?.meta.changes ?? 0) : 0, // statement 1 is the move
        months_merged: months,
        schedules_moved: schedules > 0 ? scheduleChanges(results, plan) : 0,
      };
    }
  }
  throw new Conflict("Category");
}

export function deleteCategory(
  env: Env,
  actor: string,
  input: { budget_id: string; category_id: string; reassign_to?: string },
) {
  return run(env, actor, input.budget_id, {
    categoryId: input.category_id,
    reassignTo: input.reassign_to,
  });
}

export function deleteCategoryGroup(
  env: Env,
  actor: string,
  input: { budget_id: string; group_id: string; reassign_to?: string },
) {
  return run(env, actor, input.budget_id, {
    groupId: input.group_id,
    reassignTo: input.reassign_to,
  });
}
