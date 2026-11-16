import { and, asc, eq, isNull, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";

export type AccountRow = typeof accounts.$inferSelect;

export async function findActive(
  db: Db,
  budgetId: string,
  id: string,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)))
    .limit(1);
  return row;
}

/** The highest sort_order among the plan's active accounts, or -1 when there is none. */
export async function maxSort(db: Db, budgetId: string): Promise<number> {
  const [r] = await db
    .select({ m: sql<number | null>`max(${accounts.sortOrder})` })
    .from(accounts)
    .where(and(eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)));
  return r?.m ?? -1;
}

/** A `SELECT 1` that holds while `sort` is still the next free sort_order, for the guarded insert. */
export function sortIsNext(db: Db, budgetId: string, sort: number) {
  return db
    .select({ x: sql`1` })
    .from(sql`(select 1)`)
    .where(
      sql`(select coalesce(max(${accounts.sortOrder}), -1) + 1 from ${accounts} where ${accounts.budgetId} = ${budgetId} and ${accounts.deletedAt} is null) = ${sort}`,
    );
}

/** Inserts the row only while its sort_order is still the next free one (so concurrent creates never share one). */
export function insertIfSortStmt(db: Db, row: AccountRow) {
  const r = row;
  return db
    .insert(accounts)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.name}, ${r.type}, ${r.onBudget ? 1 : 0}, ${r.note}, ${r.starred ? 1 : 0}, ${r.closed ? 1 : 0}, ${r.sortOrder}, ${r.createdAt}, ${r.deletedAt} where exists ${sortIsNext(db, r.budgetId, r.sortOrder)}`,
    );
}

/** The plan's non-deleted accounts in display order (`sort_order`, then id). */
export async function list(
  db: Db,
  budgetId: string,
  opts: { includeClosed: boolean },
): Promise<AccountRow[]> {
  const conds = [eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)];
  if (!opts.includeClosed) conds.push(eq(accounts.closed, false));
  return db
    .select()
    .from(accounts)
    .where(and(...conds))
    .orderBy(asc(accounts.sortOrder), asc(accounts.id));
}

/** True when a non-deleted account of the plan (closed ones included) has this name, ignoring ASCII case. */
export async function nameTaken(db: Db, budgetId: string, name: string): Promise<boolean> {
  const [r] = await db
    .select({ x: sql`1` })
    .from(accounts)
    .where(
      and(
        eq(accounts.budgetId, budgetId),
        isNull(accounts.deletedAt),
        sql`lower(${accounts.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return r !== undefined;
}

/** `SELECT 1` that holds while `sort` is the next free sort_order and no account of the plan has this name. */
export function newAccountGuard(db: Db, budgetId: string, sort: number, name: string) {
  return db
    .select({ x: sql`1` })
    .from(sql`(select 1)`)
    .where(
      sql`(select coalesce(max(${accounts.sortOrder}), -1) + 1 from ${accounts} where ${accounts.budgetId} = ${budgetId} and ${accounts.deletedAt} is null) = ${sort} and not exists (select 1 from ${accounts} where ${accounts.budgetId} = ${budgetId} and ${accounts.deletedAt} is null and lower(${accounts.name}) = lower(${name}))`,
    );
}

/** Inserts the row only while `guard` holds. Column order is the table's. */
export function insertIfStmt(db: Db, row: AccountRow, guard: SQLWrapper) {
  const r = row;
  return db
    .insert(accounts)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.name}, ${r.type}, ${r.onBudget ? 1 : 0}, ${r.note}, ${r.starred ? 1 : 0}, ${r.closed ? 1 : 0}, ${r.sortOrder}, ${r.createdAt}, ${r.deletedAt} where exists ${guard}`,
    );
}

/** A `SELECT 1` that holds while the account is active with the `starred` and `closed` values of `before`. */
export function starHolds(db: Db, before: AccountRow) {
  return db.select({ x: sql`1` }).from(accounts).where(starCondition(before));
}

function starCondition(before: AccountRow) {
  return and(
    eq(accounts.id, before.id),
    isNull(accounts.deletedAt),
    eq(accounts.starred, before.starred),
    eq(accounts.closed, before.closed),
  );
}

export function setStarredIfStmt(db: Db, before: AccountRow, starred: boolean) {
  return db.update(accounts).set({ starred }).where(starCondition(before));
}

/** `SELECT 1` that holds once the account row exists. */
export function existsStmt(db: Db, id: string) {
  return db.select({ x: sql`1` }).from(accounts).where(eq(accounts.id, id));
}
