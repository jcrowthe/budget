import {
  type Category,
  CategoryCreate,
  type CategoryGroup,
  CategoryGroupCreate,
} from "@budget/schema/categories";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as groupsRepo from "../repositories/category-groups";

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
  await db.batch([
    groupsRepo.insertStmt(db, row),
    changeLogInsert(db, {
      budgetId: row.budgetId,
      actor,
      action: "create",
      entityType: "category_group",
      entityId: row.id,
      before: null,
      after: groupToApi(row),
    }),
  ]);
  return groupToApi(row);
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
  await db.batch([
    categoriesRepo.insertStmt(db, row),
    changeLogInsert(db, {
      budgetId: row.budgetId,
      actor,
      action: "create",
      entityType: "category",
      entityId: row.id,
      before: null,
      after: categoryToApi(row),
    }),
  ]);
  return categoryToApi(row);
}
