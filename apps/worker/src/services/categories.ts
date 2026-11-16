import {
  type CategoriesUnhidden,
  type Category,
  CategoryCreate,
  type CategoryGroup,
  CategoryGroupCreate,
  CategoryGroupNew,
  CategoryGroupUpdate,
  CategoryNew,
  CategoryUpdate,
} from "@budget/schema/categories";
import { and, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as groupsRepo from "../repositories/category-groups";
import { allOf, type LogBase, logSelectStmt, whenQuery } from "../repositories/guards";

import { PaymentLocked } from "./credit-payments";

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
    note: row.note ?? null,
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
      kind: null,
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
  const group = await groupsRepo.findActive(db, v.budget_id, v.group_id);
  if (!group) throw new NotFound("Category group");
  if (group.kind !== null) throw new PaymentLocked("payment_group_locked");
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
      note: null,
      kind: null,
      accountId: null,
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

// EXF-494, EXF-495: create at the top, rename, hide, unhide. Delete is in category-delete.ts.

/** A name is already used (group names within a plan, category names within a group). */
export class NameTaken extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NameTaken";
  }
}
/** The category or group has history and no `reassign_to` was given. */
export class HistoryExists extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryExists";
  }
}
/** `reassign_to` is not a category the history can move to. */
export class InvalidReassignTarget extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReassignTarget";
  }
}

export const GROUP_NAME_TAKEN = "This group name already exists";
export const CATEGORY_NAME_TAKEN = "A category with this name already exists in this group";

const isUuid = (s: string) => z.uuid().safeParse(s).success;

async function requirePlan(db: Db, budgetId: string) {
  if (!isUuid(budgetId) || !(await budgetsRepo.findActive(db, budgetId)))
    throw new NotFound("Plan");
}

async function requireGroup(db: Db, budgetId: string, groupId: string) {
  const g = isUuid(groupId) ? await groupsRepo.findActive(db, budgetId, groupId) : undefined;
  if (!g) throw new NotFound("Category group");
  return g;
}

async function requireCategory(db: Db, budgetId: string, id: string) {
  const c = isUuid(id) ? await categoriesRepo.findActive(db, budgetId, id) : undefined;
  if (!c) throw new NotFound("Category");
  return c;
}

/** Creates a group at the TOP of the plan's groups (appending is `createCategoryGroup`). */
export async function addCategoryGroup(
  env: Env,
  actor: string,
  input: { budget_id: string; name: string },
): Promise<CategoryGroup> {
  const { name } = CategoryGroupNew.parse({ name: input.name });
  const db = getDb(env);
  await requirePlan(db, input.budget_id);
  if (await groupsRepo.nameTaken(db, input.budget_id, name)) throw new NameTaken(GROUP_NAME_TAKEN);
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row: groupsRepo.CategoryGroupRow = {
      id: crypto.randomUUID(),
      budgetId: input.budget_id,
      name,
      sortOrder: ((await groupsRepo.minSort(db, input.budget_id)) ?? 1) - 1,
      hidden: false,
      collapsed: false,
      kind: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const guard = and(
      groupsRepo.sortIsFirst(row.budgetId, row.sortOrder),
      groupsRepo.nameFree(row.budgetId, name),
    ) as SQL;
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
        whenQuery(db, guard),
      ),
      groupsRepo.insertIfStmt(db, row, guard),
    ]);
    if (result.meta.changes > 0) return groupToApi(row);
    if (await groupsRepo.nameTaken(db, input.budget_id, name))
      throw new NameTaken(GROUP_NAME_TAKEN);
  }
  throw new Conflict("Category group order");
}

/** Creates a category at the TOP of its group (appending is `createCategory`). */
export async function addCategory(
  env: Env,
  actor: string,
  input: { budget_id: string; group_id: string; name: string },
): Promise<Category> {
  const { name } = CategoryNew.parse({ group_id: input.group_id, name: input.name });
  const db = getDb(env);
  await requirePlan(db, input.budget_id);
  const target = await requireGroup(db, input.budget_id, input.group_id);
  if (target.kind !== null) throw new PaymentLocked("payment_group_locked");
  if (await categoriesRepo.nameTaken(db, input.group_id, name)) {
    throw new NameTaken(CATEGORY_NAME_TAKEN);
  }
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row: categoriesRepo.CategoryRow = {
      id: crypto.randomUUID(),
      budgetId: input.budget_id,
      groupId: input.group_id,
      name,
      sortOrder: ((await categoriesRepo.minSort(db, input.group_id)) ?? 1) - 1,
      hidden: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      note: null,
      kind: null,
      accountId: null,
    };
    const guard = and(
      categoriesRepo.sortIsFirst(row.groupId, row.sortOrder),
      categoriesRepo.nameFree(row.groupId, name),
      sql`exists (select 1 from category_groups where id = ${row.groupId} and deleted_at is null)`,
    ) as SQL;
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
        whenQuery(db, guard),
      ),
      categoriesRepo.insertIfStmt(db, row, guard),
    ]);
    if (result.meta.changes > 0) return categoryToApi(row);
    await requireGroup(db, input.budget_id, input.group_id);
    if (await categoriesRepo.nameTaken(db, input.group_id, name)) {
      throw new NameTaken(CATEGORY_NAME_TAKEN);
    }
  }
  throw new Conflict("Category order");
}

/**
 * Renames, hides/unhides and/or collapses a group. Collapse is interface state: a PATCH of only `collapsed`
 * writes no change_log row. Unhiding a hidden group unhides all its categories too.
 */
export async function updateCategoryGroup(
  env: Env,
  actor: string,
  input: { budget_id: string; group_id: string } & CategoryGroupUpdate,
): Promise<CategoryGroup> {
  const patch = CategoryGroupUpdate.parse({
    name: input.name,
    hidden: input.hidden,
    collapsed: input.collapsed,
  });
  const db = getDb(env);
  await requirePlan(db, input.budget_id);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await requireGroup(db, input.budget_id, input.group_id);
    if (
      before.kind !== null &&
      ((patch.name !== undefined && patch.name !== before.name) ||
        (patch.hidden !== undefined && patch.hidden !== before.hidden))
    ) {
      throw new PaymentLocked("payment_group_locked");
    }
    if (
      patch.name !== undefined &&
      (await groupsRepo.nameTaken(db, before.budgetId, patch.name, before.id))
    ) {
      throw new NameTaken(GROUP_NAME_TAKEN);
    }
    const after: groupsRepo.CategoryGroupRow = {
      ...before,
      name: patch.name ?? before.name,
      hidden: patch.hidden ?? before.hidden,
      collapsed: patch.collapsed ?? before.collapsed,
    };
    const changed =
      after.name !== before.name ||
      after.hidden !== before.hidden ||
      after.collapsed !== before.collapsed;
    if (!changed) return groupToApi(before);
    const logged = after.name !== before.name || after.hidden !== before.hidden;
    const now = new Date().toISOString();
    after.updatedAt = now;
    const guard = groupsRepo.holds(before.id, before.updatedAt);
    const nameGuard =
      patch.name !== undefined ? groupsRepo.nameFree(before.budgetId, after.name, before.id) : null;
    const g = allOf(guard, nameGuard);
    const unhideCats = before.hidden && patch.hidden === false;
    const log: LogBase = {
      budgetId: before.budgetId,
      actor,
      action: "update",
      entityType: "category",
      createdAt: now,
    };
    const stmts: BatchItem<"sqlite">[] = [];
    if (logged) {
      stmts.push(
        changeLogInsertIf(
          db,
          {
            budgetId: before.budgetId,
            actor,
            action: "update",
            entityType: "category_group",
            entityId: before.id,
            before: groupToApi(before),
            after: groupToApi(after),
          },
          whenQuery(db, g),
        ),
      );
    }
    if (unhideCats) {
      stmts.push(
        logSelectStmt(db, log, categoriesRepo.flipInGroupInner(before.id, false, g), {
          entityId: sql`id`,
          before: categoriesRepo.categoryJson(),
          after: categoriesRepo.categoryJsonHidden(false),
        }),
        categoriesRepo.flipInGroupStmt(db, before.id, false, now, g),
      );
    }
    stmts.push(
      groupsRepo.updateIfStmt(
        db,
        before.id,
        { name: after.name, hidden: after.hidden, collapsed: after.collapsed, updatedAt: now },
        g,
      ),
    );
    const results = await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    if (results[results.length - 1].meta.changes > 0) return groupToApi(after);
  }
  throw new Conflict("Category group");
}

/**
 * Renames or hides/unhides a category. Unhiding a category whose group is hidden brings the group back with
 * only that category: the group is unhidden and the group's other visible categories are hidden (their own flag),
 * so nothing else reappears and every row keeps its sort_order.
 */
export async function updateCategory(
  env: Env,
  actor: string,
  input: { budget_id: string; category_id: string } & CategoryUpdate,
): Promise<Category> {
  const patch = CategoryUpdate.parse({ name: input.name, hidden: input.hidden, note: input.note });
  const db = getDb(env);
  await requirePlan(db, input.budget_id);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await requireCategory(db, input.budget_id, input.category_id);
    const group = (await groupsRepo.findActive(
      db,
      before.budgetId,
      before.groupId,
    )) as groupsRepo.CategoryGroupRow;
    if (
      before.kind !== null &&
      ((patch.name !== undefined && patch.name !== before.name) ||
        (patch.hidden !== undefined && patch.hidden !== before.hidden))
    ) {
      throw new PaymentLocked("payment_category_locked");
    }
    if (
      patch.name !== undefined &&
      (await categoriesRepo.nameTaken(db, before.groupId, patch.name, before.id))
    ) {
      throw new NameTaken(CATEGORY_NAME_TAKEN);
    }
    const after: categoriesRepo.CategoryRow = {
      ...before,
      name: patch.name ?? before.name,
      hidden: patch.hidden ?? before.hidden,
      note: patch.note === undefined ? before.note : patch.note?.trim() || null,
    };
    const bringGroupBack = patch.hidden === false && group.hidden;
    if (
      after.name === before.name &&
      after.hidden === before.hidden &&
      after.note === before.note &&
      !bringGroupBack
    ) {
      return categoryToApi(before);
    }
    const now = new Date().toISOString();
    after.updatedAt = now;
    const catGuard = allOf(
      categoriesRepo.holds(before.id, before.updatedAt),
      patch.name !== undefined
        ? categoriesRepo.nameFree(before.groupId, after.name, before.id)
        : null,
      bringGroupBack ? groupsRepo.holds(group.id, group.updatedAt) : null,
    );
    const base: LogBase = {
      budgetId: before.budgetId,
      actor,
      action: "update",
      entityType: "category",
      createdAt: now,
    };
    const stmts: BatchItem<"sqlite">[] = [];
    if (bringGroupBack) {
      // Siblings first: they and the group are guarded on the group's updated_at, which its own update changes.
      stmts.push(
        logSelectStmt(
          db,
          base,
          categoriesRepo.flipInGroupInner(group.id, true, catGuard, before.id),
          {
            entityId: sql`id`,
            before: categoriesRepo.categoryJson(),
            after: categoriesRepo.categoryJsonHidden(true),
          },
        ),
        categoriesRepo.flipInGroupStmt(db, group.id, true, now, catGuard, before.id),
      );
    }
    if (
      after.name !== before.name ||
      after.hidden !== before.hidden ||
      after.note !== before.note
    ) {
      stmts.push(
        changeLogInsertIf(
          db,
          {
            budgetId: before.budgetId,
            actor,
            action: "update",
            entityType: "category",
            entityId: before.id,
            before: categoryToApi(before),
            after: categoryToApi(after),
          },
          whenQuery(db, catGuard),
        ),
      );
    }
    stmts.push(
      categoriesRepo.updateIfStmt(
        db,
        before.id,
        { name: after.name, hidden: after.hidden, note: after.note, updatedAt: now },
        catGuard,
      ),
    );
    const catIdx = stmts.length - 1;
    if (bringGroupBack) {
      const groupAfter = { ...group, hidden: false };
      // Only when the category's own update of this batch applied (now is unique to it), so the group never
      // returns with its other categories; and the group must still be what was read.
      const groupGuard = allOf(
        groupsRepo.holds(group.id, group.updatedAt),
        sql`exists (select 1 from categories where id = ${before.id} and updated_at = ${now} and hidden = 0)`,
      );
      stmts.push(
        changeLogInsertIf(
          db,
          {
            budgetId: before.budgetId,
            actor,
            action: "update",
            entityType: "category_group",
            entityId: group.id,
            before: groupToApi(group),
            after: groupToApi(groupAfter),
          },
          whenQuery(db, groupGuard),
        ),
        groupsRepo.updateIfStmt(db, group.id, { hidden: false, updatedAt: now }, groupGuard),
      );
    }
    const results = await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    if (results[catIdx].meta.changes > 0) return categoryToApi(after);
  }
  throw new Conflict("Category");
}

/** Unhides every group and category of the plan in one batch; answers with the ids that changed. */
export async function unhideAll(
  env: Env,
  actor: string,
  budgetId: string,
): Promise<CategoriesUnhidden> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const groups = await groupsRepo.listHidden(db, budgetId);
  const cats = await categoriesRepo.listHiddenInPlan(db, budgetId);
  if (groups.length === 0 && cats.length === 0) return { group_ids: [], category_ids: [] };
  const now = new Date().toISOString();
  const base = (entityType: string): LogBase => ({
    budgetId,
    actor,
    action: "update",
    entityType,
    createdAt: now,
  });
  await db.batch([
    logSelectStmt(db, base("category_group"), groupsRepo.hiddenGroupsInner(budgetId), {
      entityId: sql`id`,
      before: groupsRepo.groupJson(),
      after: groupsRepo.groupJson(false),
    }),
    groupsRepo.unhideAllGroupsStmt(db, budgetId, now),
    logSelectStmt(db, base("category"), categoriesRepo.hiddenInPlanInner(budgetId), {
      entityId: sql`id`,
      before: categoriesRepo.categoryJson(),
      after: categoriesRepo.categoryJsonHidden(false),
    }),
    categoriesRepo.unhideAllStmt(db, budgetId, now),
  ]);
  return { group_ids: groups.map((g) => g.id), category_ids: cats.map((c) => c.id) };
}
