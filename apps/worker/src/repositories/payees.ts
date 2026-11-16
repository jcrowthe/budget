import type { PayeeSystem } from "@budget/schema/payees";
import { and, eq, isNull, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { payees } from "../db/schema/payees";

export type PayeeRow = typeof payees.$inferSelect;
export type PayeeListRow = PayeeRow & { lastCategoryId: string | null };

/** Non-deleted payees of the plan, with the category of each one's latest transaction. */
export async function listForPlan(
  db: Db,
  budgetId: string,
  opts: { includeHidden: boolean },
): Promise<PayeeListRow[]> {
  const conds = [eq(payees.budgetId, budgetId), isNull(payees.deletedAt)];
  if (!opts.includeHidden) conds.push(eq(payees.hidden, false));
  const rows = await db
    .select({
      p: payees,
      live: sql<
        string | null
      >`(select c.id from categories c where c.id = (select t.category_id from transactions t
        where t.payee_id = payees.id and t.deleted_at is null
        order by t.date desc, t.created_at desc, t.id desc limit 1) and c.deleted_at is null)`,
    })
    .from(payees)
    .where(and(...conds));
  return rows.map((r) => ({ ...r.p, lastCategoryId: r.live ?? null }));
}

export async function findActive(
  db: Db,
  budgetId: string,
  id: string,
): Promise<PayeeRow | undefined> {
  const [r] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.id, id), eq(payees.budgetId, budgetId), isNull(payees.deletedAt)))
    .limit(1);
  return r;
}

/** An ordinary (non-system) payee by its exact name. */
export async function findByName(
  db: Db,
  budgetId: string,
  name: string,
): Promise<PayeeRow | undefined> {
  const [r] = await db
    .select()
    .from(payees)
    .where(
      and(
        eq(payees.budgetId, budgetId),
        eq(payees.name, name),
        isNull(payees.system),
        isNull(payees.deletedAt),
      ),
    )
    .limit(1);
  return r;
}

export async function findSystem(
  db: Db,
  budgetId: string,
  system: PayeeSystem,
): Promise<PayeeRow | undefined> {
  const [r] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.budgetId, budgetId), eq(payees.system, system), isNull(payees.deletedAt)))
    .limit(1);
  return r;
}

export function insertStmt(db: Db, row: PayeeRow) {
  return db.insert(payees).values(row);
}

/** Inserts the payee only while `guard` holds. Column order is the table's. */
export function insertIfStmt(db: Db, row: PayeeRow, guard: SQLWrapper) {
  const r = row;
  return db
    .insert(payees)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.name}, ${r.hidden ? 1 : 0}, ${r.system}, ${r.createdAt}, ${r.updatedAt}, ${r.deletedAt} where exists ${guard}`,
    );
}

/** Inserts the system payee unless the plan already has one of that kind. */
export function insertSystemIfMissingStmt(db: Db, row: PayeeRow) {
  const r = row;
  return db
    .insert(payees)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.name}, ${r.hidden ? 1 : 0}, ${r.system}, ${r.createdAt}, ${r.updatedAt}, ${r.deletedAt} where not exists (select 1 from payees p where p.budget_id = ${r.budgetId} and p.system = ${r.system} and p.deleted_at is null)`,
    );
}

/** A scalar subquery for a `payee_id` column value: the plan's system payee of that kind. */
export function systemIdSql(budgetId: string, system: PayeeSystem) {
  return sql`(select p.id from payees p where p.budget_id = ${budgetId} and p.system = ${system} and p.deleted_at is null)`;
}

export function existsStmt(db: Db, id: string) {
  return db.select({ x: sql`1` }).from(payees).where(eq(payees.id, id));
}

export function isUniqueViolation(e: unknown): boolean {
  const msgs: string[] = [];
  for (let x: unknown = e; x instanceof Error; x = x.cause) msgs.push(x.message);
  return msgs.some((m) => m.includes("UNIQUE constraint failed: payees"));
}
