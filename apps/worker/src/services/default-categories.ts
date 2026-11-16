import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../db/client";
import { changeLogInsert } from "../history/change-log";
import * as categoriesRepo from "../repositories/categories";
import * as groupsRepo from "../repositories/category-groups";
import { categoryToApi, groupToApi } from "./categories";

/** The groups and categories every new plan starts with, in order (EXF-487). U+FE0F is kept where the source has it. */
export const DEFAULT_CATEGORIES: readonly { group: string; categories: readonly string[] }[] = [
  {
    group: "Bills",
    categories: ["🏠 Rent/Mortgage", "📱 Phone & Internet", "⚡️ Utilities"],
  },
  {
    group: "Needs",
    categories: [
      "🛒 Groceries",
      "🚘 Transportation",
      "💆 Health & Personal Care",
      "😌 Emergency fund",
    ],
  },
  {
    group: "Wants",
    categories: ["🍽️ Dining out", "🍿 Entertainment", "🏝️ Vacation", "❗️ Stuff I forgot to plan for"],
  },
];

/**
 * Unexecuted statements that create the default groups and categories of a brand-new plan, each followed by its
 * change_log row. Meant for the same `db.batch` as the plan insert, so a plan never exists half-populated.
 */
export function defaultCategoryStmts(
  db: Db,
  budgetId: string,
  actor: string,
  now: string,
): BatchItem<"sqlite">[] {
  const stmts: BatchItem<"sqlite">[] = [];
  DEFAULT_CATEGORIES.forEach((g, gi) => {
    const group: groupsRepo.CategoryGroupRow = {
      id: crypto.randomUUID(),
      budgetId,
      name: g.group,
      sortOrder: gi,
      hidden: false,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    stmts.push(
      groupsRepo.insertIfSortStmt(db, group),
      changeLogInsert(db, {
        budgetId,
        actor,
        action: "create",
        entityType: "category_group",
        entityId: group.id,
        before: null,
        after: groupToApi(group),
      }),
    );
    g.categories.forEach((name, ci) => {
      const cat: categoriesRepo.CategoryRow = {
        id: crypto.randomUUID(),
        budgetId,
        groupId: group.id,
        name,
        sortOrder: ci,
        hidden: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        note: null,
      };
      stmts.push(
        categoriesRepo.insertIfSortStmt(db, cat),
        changeLogInsert(db, {
          budgetId,
          actor,
          action: "create",
          entityType: "category",
          entityId: cat.id,
          before: null,
          after: categoryToApi(cat),
        }),
      );
    });
  });
  return stmts;
}
