import {
  type Category,
  CategoryCreate,
  type CategoryGroup,
  CategoryGroupCreate,
} from "@budget/schema/categories";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as groupsRepo from "../repositories/category-groups";

const MAX_ATTEMPTS = 5;

export function groupToApi(row: groupsRepo.CategoryGroupRow): CategoryGroup {
  return {
    id: row.id,
    budget_id: row.budgetId,
    name: row.name,
    sort: row.sortOrder,
    hidden: row.hidden,
    collapsed: row.collapsed,
  };
}

export function categoryToApi(row: categoriesRepo.CategoryRow): Category {
  return {
    id: row.id,
    budget_id: row.budgetId,
    group_id: row.groupId,
    name: row.name,
    sort: row.sortOrder,
    hidden: row.hidden,
  };
}

export async function createCategoryGroup(
  env: Env,
  actor: string,
  input: CategoryGroupCreate,
): Promise<CategoryGroup> {
  const v = CategoryGroupCreate.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, v.budget_id))) throw new NotFound("Plan");
  const now = new Date().toISOString();
  // The sort_order is the next free one when read; the guarded insert (log first) only writes while that still
  // holds, so concurrent creates never share a sort. A lost race re-reads and retries.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row: groupsRepo.CategoryGroupRow = {
      id: crypto.randomUUID(),
      budgetId: v.budget_id,
      name: v.name,
      sortOrder: (await groupsRepo.maxSort(db, v.budget_id)) + 1,
      hidden: v.hidden ?? false,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const [, result] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId: row.budgetId,
          actor,
          action: "create",
          entityType: "category_group",
          entityId: row.id,
          before: null,
          after: groupToApi(row),
        },
        groupsRepo.sortIsNext(db, row.budgetId, row.sortOrder),
      ),
      groupsRepo.insertIfSortStmt(db, row),
    ]);
    if (result.meta.changes > 0) return groupToApi(row);
  }
  throw new Conflict("Category group order");
}

export async function createCategory(
  env: Env,
  actor: string,
  input: CategoryCreate,
): Promise<Category> {
  const v = CategoryCreate.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, v.budget_id))) throw new NotFound("Plan");
  if (!(await groupsRepo.findActive(db, v.budget_id, v.group_id))) {
    throw new NotFound("Category group");
  }
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row: categoriesRepo.CategoryRow = {
      id: crypto.randomUUID(),
      budgetId: v.budget_id,
      groupId: v.group_id,
      name: v.name,
      sortOrder: (await categoriesRepo.maxSort(db, v.group_id)) + 1,
      hidden: v.hidden ?? false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const [, result] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId: row.budgetId,
          actor,
          action: "create",
          entityType: "category",
          entityId: row.id,
          before: null,
          after: categoryToApi(row),
        },
        categoriesRepo.sortIsNext(db, row.groupId, row.sortOrder),
      ),
      categoriesRepo.insertIfSortStmt(db, row),
    ]);
    if (result.meta.changes > 0) return categoryToApi(row);
  }
  throw new Conflict("Category order");
}
