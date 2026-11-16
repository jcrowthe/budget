import type { PayeeSystem } from "@budget/schema/payees";
import { and, eq, isNull, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { payees } from "../db/schema/payees";

export type PayeeRow = typeof payees.$inferSelect;
export type PayeeListRow = PayeeRow & {
  lastCategoryId: string | null;
  lastInflowToReadyToAssign: boolean;
};

/** Non-deleted payees of the plan, with the category of each one's latest transaction. */
export async function listForPlan(
  db: Db,
  budgetId: string,
  opts: { includeHidden: boolean },
): Promise<PayeeListRow[]> {
  const conds = [eq(payees.budgetId, budgetId), isNull(payees.deletedAt)];
  if (!opts.includeHidden) conds.push(eq(payees.hidden, false));
  const latestId = sql`(select t.id from transactions t
        where t.payee_id = payees.id and t.deleted_at is null and t.parent_transaction_id is null
        and not exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null)
        order by t.date desc, t.created_at desc, t.id desc limit 1)`;
  const rows = await db
    .select({
      p: payees,
      live: sql<
        string | null
      >`(select c.id from categories c where c.id = (select category_id from transactions where id = ${latestId}) and c.deleted_at is null)`,
      rta: sql<number>`case when payees.system is null then coalesce((select inflow_to_ready_to_assign from transactions where id = ${latestId}), 0) else 0 end`,
    })
    .from(payees)
    .where(and(...conds));
  return rows.map((r) => ({
    ...r.p,
    lastCategoryId: r.live ?? null,
    lastInflowToReadyToAssign: Number(r.rta) === 1,
  }));
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

/** Inserts the ordinary payee unless the plan has a live one with that name, and only while `guard` holds. */
export function insertByNameIfMissingStmt(db: Db, row: PayeeRow, guard: SQLWrapper) {
  const r = row;
  return db
    .insert(payees)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.name}, ${r.hidden ? 1 : 0}, ${r.system}, ${r.createdAt}, ${r.updatedAt}, ${r.deletedAt} where ${missingByNameSql(r.budgetId, r.name)} and exists ${guard}`,
    );
}

/** True while the plan has no live ordinary payee of that name (a condition, for `where`). */
export function missingByNameSql(budgetId: string, name: string): SQL {
  return sql`not exists (select 1 from payees p where p.budget_id = ${budgetId} and p.name = ${name} and p.system is null and p.deleted_at is null)`;
}

/** The same as a guard for `changeLogInsertIf`. */
export function missingByNameGuard(budgetId: string, name: string): SQLWrapper {
  return sql`(select 1 where ${missingByNameSql(budgetId, name)})`;
}

/** A scalar subquery for a `payee_id` value: the plan's live ordinary payee with that name. */
export function ordinaryIdByNameSql(budgetId: string, name: string): SQL {
  return sql`(select p.id from payees p where p.budget_id = ${budgetId} and p.name = ${name} and p.system is null and p.deleted_at is null)`;
}
