import {
  BUILTIN_VIEW_KEYS,
  CUSTOM_VIEW_ERRORS,
  type CustomView,
  CustomViewCreate,
  type CustomViewsList,
  CustomViewUpdate,
  isBuiltinViewKey,
} from "@budget/schema/custom-views";
import type { CustomViewScope } from "@budget/schema/plan-views";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as repo from "../repositories/custom-views";

const MAX_ATTEMPTS = 5;

const fail = (message: string): never => {
  throw new HTTPException(422, { message });
};
const zodMessage = (e: { issues: { message: string }[] }) =>
  e.issues.map((i) => i.message).join("; ");

/** A built-in's saved position when it has none: before every saved or custom view, in key order. */
const defaultPosition = (key: string) =>
  BUILTIN_VIEW_KEYS.indexOf(key as never) - BUILTIN_VIEW_KEYS.length;

/** One D1 batch of drizzle statements (builders or raw): drizzle's own batch cannot take raw SQL. */
async function batch(env: Env, stmts: unknown[]): Promise<D1Result<unknown>[]> {
  const list = stmts.map((s) => {
    const x = s as {
      toSQL?: () => { sql: string; params: unknown[] };
      getQuery?: () => { sql: string; params: unknown[] };
    };
    const q = (x.toSQL ? x.toSQL() : x.getQuery?.()) as { sql: string; params: unknown[] };
    return env.DB.prepare(q.sql).bind(...q.params);
  });
  return env.DB.batch(list);
}
const rowsOf = <T>(r: D1Result<unknown> | undefined) => (r?.results ?? []) as T[];

const planActive = (db: Db, budgetId: string) =>
  db.all<{ id: string }>(sql`select id from budgets where id = ${budgetId} and deleted_at is null`);

const toView = (r: repo.ViewListRow): CustomView => ({
  id: r.view_id,
  name: r.view_name ?? "",
  category_ids: JSON.parse(r.live_ids) as string[],
  sort_order: r.view_sort_order,
  created_at: r.view_created_at,
  updated_at: r.view_updated_at,
});

/** Chip order: customs and saved built-in positions by (sort_order, id), the unsaved built-ins at their defaults. */
function listFrom(rows: repo.ViewListRow[]): CustomViewsList {
  const entries: { key: string; pos: number; view?: CustomView }[] = [];
  const saved = new Set<string>();
  for (const r of rows) {
    if (r.builtin_key) {
      saved.add(r.builtin_key);
      entries.push({ key: r.builtin_key, pos: r.view_sort_order });
    } else entries.push({ key: r.view_id, pos: r.view_sort_order, view: toView(r) });
  }
  for (const k of BUILTIN_VIEW_KEYS)
    if (!saved.has(k)) entries.push({ key: k, pos: defaultPosition(k) });
  entries.sort((a, b) => a.pos - b.pos || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    order: entries.map((e) => e.key),
    views: entries.flatMap((e) => (e.view ? [e.view] : [])),
  };
}

async function readList(env: Env, budgetId: string): Promise<CustomViewsList> {
  const db = getDb(env);
  const [plan, rows] = await batch(env, [planActive(db, budgetId), repo.listStmt(db, budgetId)]);
  if (rowsOf(plan).length === 0) throw new NotFound("Plan");
  return listFrom(rowsOf(rows));
}

export const listViews = readList;

const refuseBuiltin = (viewId: string) => {
  if (isBuiltinViewKey(viewId)) fail(CUSTOM_VIEW_ERRORS.builtin);
};

/** The ids once each, in the given order. */
const distinct = (ids: readonly string[]) => [...new Set(ids)];

export async function createView(
  env: Env,
  actor: string,
  budgetId: string,
  input: unknown,
): Promise<CustomView> {
  const v = CustomViewCreate.safeParse(input);
  if (!v.success) return fail(zodMessage(v.error));
  const ids = distinct(v.data.category_ids);
  const db = getDb(env);
  const [plan, count] = await batch(env, [
    planActive(db, budgetId),
    repo.liveCategoryCountStmt(db, budgetId, JSON.stringify(ids)),
  ]);
  if (rowsOf(plan).length === 0) throw new NotFound("Plan");
  if ((rowsOf<{ n: number }>(count)[0]?.n ?? 0) !== ids.length) throw new NotFound("Category");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const [, , rows] = await batch(env, [
    repo.insertStmt(db, { id, budgetId, name: v.data.name, categoryIds: JSON.stringify(ids), now }),
    repo.createLogStmt(db, budgetId, actor, id),
    repo.listStmt(db, budgetId, id),
  ]);
  const row = rowsOf<repo.ViewListRow>(rows)[0];
  if (!row) throw new Conflict("View");
  return toView(row);
}

export async function updateView(
  env: Env,
  actor: string,
  budgetId: string,
  viewId: string,
  input: unknown,
): Promise<CustomView> {
  refuseBuiltin(viewId);
  const v = CustomViewUpdate.safeParse(input);
  if (!v.success) return fail(zodMessage(v.error));
  const ids = v.data.category_ids === undefined ? undefined : distinct(v.data.category_ids);
  const db = getDb(env);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [plan, rows, count] = await batch(env, [
      planActive(db, budgetId),
      repo.listStmt(db, budgetId, viewId),
      repo.liveCategoryCountStmt(db, budgetId, JSON.stringify(ids ?? [])),
    ]);
    if (rowsOf(plan).length === 0) throw new NotFound("Plan");
    const before = rowsOf<repo.ViewListRow>(rows)[0];
    if (!before) throw new NotFound("View");
    if (ids && (rowsOf<{ n: number }>(count)[0]?.n ?? 0) !== ids.length)
      throw new NotFound("Category");
    const name = v.data.name ?? before.view_name ?? "";
    const stored = ids ? JSON.stringify(ids) : before.stored_ids;
    const after = {
      name,
      category_ids: ids ?? (JSON.parse(before.live_ids) as string[]),
      sort_order: before.view_sort_order,
    };
    const now = new Date().toISOString();
    const [, write] = await batch(env, [
      repo.guardedLog(
        db,
        {
          budgetId,
          actor,
          action: "update",
          id: viewId,
          before: repo.viewLog(toView(before)),
          after,
        },
        before.view_updated_at,
      ),
      repo.updateStmt(
        db,
        viewId,
        before.view_updated_at,
        { name, ...(ids ? { categoryIds: stored } : {}) },
        now,
      ),
    ]);
    if ((write?.meta.changes ?? 0) > 0) return { ...toView(before), ...after, updated_at: now };
  }
  throw new Conflict("View");
}

export async function deleteView(
  env: Env,
  actor: string,
  budgetId: string,
  viewId: string,
): Promise<CustomView> {
  refuseBuiltin(viewId);
  const db = getDb(env);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [plan, rows] = await batch(env, [
      planActive(db, budgetId),
      repo.listStmt(db, budgetId, viewId),
    ]);
    if (rowsOf(plan).length === 0) throw new NotFound("Plan");
    const before = rowsOf<repo.ViewListRow>(rows)[0];
    if (!before) throw new NotFound("View");
    const now = new Date().toISOString();
    const [, write] = await batch(env, [
      repo.guardedLog(
        db,
        {
          budgetId,
          actor,
          action: "delete",
          id: viewId,
          before: repo.viewLog(toView(before)),
          after: null,
        },
        before.view_updated_at,
      ),
      repo.softDeleteStmt(db, viewId, before.view_updated_at, now),
    ]);
    if ((write?.meta.changes ?? 0) > 0) return toView(before);
  }
  throw new Conflict("View");
}

export async function reorderViews(
  env: Env,
  actor: string,
  budgetId: string,
  input: unknown,
): Promise<CustomViewsList> {
  const ids = (input as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== "string"))
    return fail(CUSTOM_VIEW_ERRORS.reorder);
  const list = ids as string[];
  const db = getDb(env);
  const [plan, rows] = await batch(env, [planActive(db, budgetId), repo.listStmt(db, budgetId)]);
  if (rowsOf(plan).length === 0) throw new NotFound("Plan");
  const current = listFrom(rowsOf(rows)).order;
  if (
    list.length !== current.length ||
    new Set(list).size !== list.length ||
    !current.every((k) => list.includes(k))
  )
    return fail(CUSTOM_VIEW_ERRORS.reorder);
  const idsJson = JSON.stringify(list);
  const now = new Date().toISOString();
  await batch(env, [
    changeLogInsert(db, {
      budgetId,
      actor,
      action: "update",
      entityType: "plan_view_order",
      entityId: budgetId,
      before: current,
      after: list,
    }),
    repo.reorderCustomStmt(db, budgetId, idsJson),
    repo.reorderBuiltinsStmt(db, budgetId, idsJson, now),
  ]);
  const byId = new Map(listFrom(rowsOf(rows)).views.map((x) => [x.id, x]));
  return {
    order: list,
    views: list.flatMap((k, i) => {
      const x = byId.get(k);
      return x ? [{ ...x, sort_order: i }] : [];
    }),
  };
}

/** The scope of a custom view for a month read. 404 for an unknown, deleted, other-plan or built-in id. */
export async function getViewScope(
  env: Env,
  budgetId: string,
  viewId: string,
): Promise<CustomViewScope> {
  const db = getDb(env);
  const [plan, rows] = await batch(env, [
    planActive(db, budgetId),
    repo.listStmt(db, budgetId, viewId),
  ]);
  if (rowsOf(plan).length === 0) throw new NotFound("Plan");
  const row = rowsOf<repo.ViewListRow>(rows)[0];
  if (!row) throw new NotFound("View");
  return { id: row.view_id, name: row.view_name ?? "", category_ids: JSON.parse(row.live_ids) };
}
