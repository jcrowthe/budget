import { and, eq, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { monthCategories } from "../db/schema/month-categories";
import { idList, type LogBase, logSelectStmt } from "./guards";
import { insertSelect } from "./insert-select";

export type MonthCategoryRow = typeof monthCategories.$inferSelect;

export async function listForBudget(db: Db, budgetId: string): Promise<MonthCategoryRow[]> {
  return db.select().from(monthCategories).where(eq(monthCategories.budgetId, budgetId));
}

export async function find(
  db: Db,
  budgetId: string,
  month: string,
  categoryId: string,
): Promise<MonthCategoryRow | undefined> {
  const [row] = await db
    .select()
    .from(monthCategories)
    .where(
      and(
        eq(monthCategories.budgetId, budgetId),
        eq(monthCategories.month, month),
        eq(monthCategories.categoryId, categoryId),
      ),
    )
    .limit(1);
  return row;
}

interface Cell {
  budgetId: string;
  month: string;
  categoryId: string;
}

const sameCell = (c: Cell) =>
  and(
    eq(monthCategories.budgetId, c.budgetId),
    eq(monthCategories.month, c.month),
    eq(monthCategories.categoryId, c.categoryId),
  );

/**
 * A `SELECT 1` that holds while the cell is still what was read: its row holds `before`, or (when `before` is
 * undefined, the row was missing) there is still no row. For `changeLogInsertIf`.
 */
export function holds(db: Db, c: Cell, before: number | undefined) {
  if (before === undefined) {
    return db
      .select({ x: sql`1` })
      .from(sql`(select 1)`)
      .where(sql`not exists (select 1 from ${monthCategories} where ${sameCell(c)})`);
  }
  return db
    .select({ x: sql`1` })
    .from(monthCategories)
    .where(and(sameCell(c), eq(monthCategories.assigned, before)));
}

/**
 * Sets the cell to `assigned` only while it still holds `before` (see `holds`); otherwise it changes 0 rows.
 * `guard` is an extra condition: a two-sided move guards its first write on both cells holding and its second
 * on `changes() > 0` (the first write changed a row), so both sides are written or neither.
 */
export function setIfHoldsStmt(
  db: Db,
  c: Cell,
  before: number | undefined,
  assigned: number,
  updatedAt: string,
  guard: SQL = sql`1`,
) {
  const prev = guard;
  if (before === undefined) {
    return insertSelect(
      db,
      monthCategories,
      { budgetId: c.budgetId, month: c.month, categoryId: c.categoryId, assigned, updatedAt },
      sql`where not exists (select 1 from ${monthCategories} where ${sameCell(c)}) and ${prev}`,
    );
  }
  return db
    .update(monthCategories)
    .set({ assigned, updatedAt })
    .where(and(sameCell(c), eq(monthCategories.assigned, before), prev));
}

// EXF-494: merging a deleted category's assigned amounts into another category.

const mergeSource = (budgetId: string, fromIds: readonly string[]) =>
  sql`from ${monthCategories} where ${monthCategories.budgetId} = ${budgetId} and ${monthCategories.categoryId} in (${idList(fromIds)}) and ${monthCategories.assigned} <> 0`;

/** The months in which the categories in `fromIds` have a non-zero total assigned. */
export async function mergeableMonths(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
): Promise<number> {
  if (fromIds.length === 0) return 0;
  const rows = await db.all<{ m: string }>(
    sql`select ${monthCategories.month} as m ${mergeSource(budgetId, fromIds)} group by ${monthCategories.month} having sum(${monthCategories.assigned}) <> 0`,
  );
  return rows.length;
}

/**
 * Adds, per month, the sum of the categories' assigned amounts to the target's cell (creating it).
 * Months whose sum is 0 are left alone.
 */
export function mergeIntoStmt(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
  targetId: string,
  now: string,
  guard: SQL,
) {
  return insertSelect(
    db,
    monthCategories,
    {
      budgetId: monthCategories.budgetId,
      month: monthCategories.month,
      categoryId: targetId,
      assigned: sql`sum(${monthCategories.assigned})`,
      updatedAt: now,
    },
    sql`${mergeSource(budgetId, fromIds)} and ${guard} group by ${monthCategories.month} having sum(${monthCategories.assigned}) <> 0`,
  ).onConflictDoUpdate({
    target: [monthCategories.budgetId, monthCategories.month, monthCategories.categoryId],
    set: {
      assigned: sql`month_categories.assigned + excluded.assigned`,
      updatedAt: sql`excluded.updated_at`,
    },
  });
}

/** One change_log row per merged month, for the target's cell (id `<target>:<month>`). */
export function logMergeStmt(
  db: Db,
  base: LogBase,
  budgetId: string,
  fromIds: readonly string[],
  targetId: string,
  guard: SQL,
) {
  const inner = sql`select m.month as month, m.sum_assigned as moved, coalesce(t.assigned, 0) as before_assigned from (select ${monthCategories.month} as month, sum(${monthCategories.assigned}) as sum_assigned ${mergeSource(budgetId, fromIds)} and ${guard} group by ${monthCategories.month} having sum(${monthCategories.assigned}) <> 0) m left join ${monthCategories} t on t.budget_id = ${budgetId} and t.category_id = ${targetId} and t.month = m.month`;
  return logSelectStmt(db, base, inner, {
    entityId: sql`${targetId} || ':' || month`,
    before: sql`json_object('month', month, 'category_id', ${targetId}, 'assigned', before_assigned)`,
    after: sql`json_object('month', month, 'category_id', ${targetId}, 'assigned', before_assigned + moved, 'reassigned_from', json(${JSON.stringify(fromIds)}))`,
  });
}
