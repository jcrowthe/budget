import { and, desc, eq, isNull, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { changeLog } from "../db/schema/change-log";
import { pendingTransactions } from "../db/schema/pending-transactions";
import { transactions } from "../db/schema/transactions";
import { currentChangeSetId } from "../history/change-set";
import { logSelectStmt } from "./guards";
import { insertSelect } from "./insert-select";

export type PendingRow = typeof pendingTransactions.$inferSelect;

const p = pendingTransactions;

/** Who the pending writes of a sync log as (the sync's own actor; the service passes it in). */
type Base = { budgetId: string; actor: string; now: string };

/** The pending item as its change_log copies show it. `prefix` names the row (`p` or a json path). */
const logJson = (
  col: (name: string) => ReturnType<typeof sql.raw>,
  resolved: ReturnType<typeof sql>,
) =>
  sql`json_object('account_id', ${col("account_id")}, 'date', ${col("date")}, 'amount', ${col("amount")}, 'payee_name', ${col("payee_name")}, 'imported_payee', ${col("imported_payee")}, 'bank_description', ${col("bank_description")}, 'plaid_transaction_id', ${col("plaid_transaction_id")}, 'resolved_at', ${resolved})`;

const own = (name: string) => sql.raw(name);
const ownLog = () => logJson(own, sql`resolved_at`);

/** The live pending items of an account (or of the plan's open linked accounts) with the account's name. */
export function pendingForAccountQuery(db: Db, budgetId: string, accountId: string | null) {
  return db
    .select({ p, accountName: accounts.name })
    .from(p)
    .innerJoin(
      accounts,
      and(
        eq(accounts.id, p.accountId),
        isNull(accounts.deletedAt),
        eq(accounts.closed, false),
        sql`${accounts.bankAccountId} is not null`,
      ),
    )
    .where(
      and(
        eq(p.budgetId, budgetId),
        isNull(p.deletedAt),
        accountId ? eq(p.accountId, accountId) : undefined,
        sql`exists (select 1 from budgets b where b.id = ${p.budgetId} and b.deleted_at is null)`,
      ),
    )
    .orderBy(desc(p.date), desc(p.createdAt), p.id);
}

/** Every row (live or deleted) of the plan with these Plaid ids; one JSON parameter for any number. */
export function pendingByPlaidIdsQuery(db: Db, budgetId: string, plaidIds: readonly string[]) {
  return db
    .select()
    .from(p)
    .where(
      and(
        eq(p.budgetId, budgetId),
        sql`${p.plaidTransactionId} in (select value from json_each(${JSON.stringify(plaidIds)}))`,
      ),
    );
}

/** Live hand-side rows entered from these pending ids, in this account (never a split line, never an import). */
export function enteredByPendingIdsQuery(
  db: Db,
  budgetId: string,
  accountId: string,
  pendingIds: readonly string[],
) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        isNull(transactions.parentTransactionId),
        isNull(transactions.importId),
        sql`${transactions.pendingTransactionId} in (select value from json_each(${JSON.stringify(pendingIds)}))`,
      ),
    );
}

export async function findLive(
  db: Db,
  budgetId: string,
  id: string,
): Promise<PendingRow | undefined> {
  const [row] = await db
    .select()
    .from(p)
    .where(and(eq(p.id, id), eq(p.budgetId, budgetId), isNull(p.deletedAt)))
    .limit(1);
  return row;
}

/** What a sync stores for one pending entry (the JSON the set statements read). */
export interface PendingItem {
  id: string;
  account_id: string;
  bank_account_id: string;
  pid: string;
  date: string;
  amount: number;
  payee_name: string | null;
  imported_payee: string | null;
  import_payee_name: string | null;
  bank_description: string | null;
  /** On a follow: the row's updated_at as read. */
  updated_at?: string;
}

const item = (json: string, key: string, ref = "pending_transactions.plaid_transaction_id") =>
  sql`(select json_extract(e.value, ${`$.${key}`}) from json_each(${json}) e where json_extract(e.value, '$.pid') = ${sql.raw(ref)})`;

/** The account is still live, open, linked to the bank account the item names, and its plan is live. */
const linkedOpen = sql`exists (select 1 from accounts a where a.id = json_extract(e.value, '$.account_id') and a.deleted_at is null and a.closed = 0 and a.bank_account_id = json_extract(e.value, '$.bank_account_id') and exists (select 1 from budgets b where b.id = a.budget_id and b.deleted_at is null))`;

/** Inserts the items that have no live row and were not entered; each with its change_log `create`. */
export function insertPendingStmts(db: Db, b: Base, items: readonly PendingItem[]) {
  const json = JSON.stringify(items);
  const fresh = sql`not exists (select 1 from pending_transactions q where q.budget_id = ${b.budgetId} and q.plaid_transaction_id = json_extract(e.value, '$.pid') and (q.deleted_at is null or q.entered_transaction_id is not null)) and ${linkedOpen}`;
  const col = (k: string) => sql.raw(`json_extract(v, '$.${k}')`);
  return [
    logSelectStmt(
      db,
      {
        budgetId: b.budgetId,
        actor: b.actor,
        action: "create",
        entityType: "pending_transaction",
        createdAt: b.now,
      },
      sql`select e.value as v from json_each(${json}) e where ${fresh}`,
      {
        entityId: sql`json_extract(v, '$.id')`,
        before: null,
        after: logJson((n) => col(n === "plaid_transaction_id" ? "pid" : n), sql`null`),
      },
    ),
    insertSelect(
      db,
      p,
      {
        id: sql`json_extract(e.value, '$.id')`,
        budgetId: b.budgetId,
        accountId: sql`json_extract(e.value, '$.account_id')`,
        plaidTransactionId: sql`json_extract(e.value, '$.pid')`,
        date: sql`json_extract(e.value, '$.date')`,
        amount: sql`json_extract(e.value, '$.amount')`,
        payeeName: sql`json_extract(e.value, '$.payee_name')`,
        importedPayee: sql`json_extract(e.value, '$.imported_payee')`,
        importPayeeName: sql`json_extract(e.value, '$.import_payee_name')`,
        bankDescription: sql`json_extract(e.value, '$.bank_description')`,
        createdAt: b.now,
        updatedAt: b.now,
      },
      sql`from json_each(${json}) e where ${fresh}`,
    ),
  ];
}

/** Updates the untouched live items whose values differ (guarded on updated_at as read); each with its `update`. */
export function followPendingStmts(db: Db, b: Base, items: readonly PendingItem[]) {
  const json = JSON.stringify(items);
  const cond = sql`pending_transactions.budget_id = ${b.budgetId} and pending_transactions.deleted_at is null and pending_transactions.entered_transaction_id is null
    and pending_transactions.updated_at = ${item(json, "updated_at")}
    and (pending_transactions.date <> ${item(json, "date")} or pending_transactions.amount <> ${item(json, "amount")} or pending_transactions.payee_name is not ${item(json, "payee_name")}
      or pending_transactions.imported_payee is not ${item(json, "imported_payee")} or pending_transactions.bank_description is not ${item(json, "bank_description")})`;
  return [
    logSelectStmt(
      db,
      {
        budgetId: b.budgetId,
        actor: b.actor,
        action: "update",
        entityType: "pending_transaction",
        createdAt: b.now,
      },
      sql`select * from pending_transactions where ${cond}`,
      {
        entityId: sql`id`,
        before: ownLog(),
        after: sql`json_set(${ownLog()}, '$.date', ${item(json, "date", "plaid_transaction_id")}, '$.amount', ${item(json, "amount", "plaid_transaction_id")}, '$.payee_name', ${item(json, "payee_name", "plaid_transaction_id")}, '$.imported_payee', ${item(json, "imported_payee", "plaid_transaction_id")}, '$.bank_description', ${item(json, "bank_description", "plaid_transaction_id")})`,
      },
    ),
    db
      .update(p)
      .set({
        date: item(json, "date") as never,
        amount: item(json, "amount") as never,
        payeeName: item(json, "payee_name") as never,
        importedPayee: item(json, "imported_payee") as never,
        importPayeeName: item(json, "import_payee_name") as never,
        bankDescription: item(json, "bank_description") as never,
        updatedAt: b.now,
      })
      .where(cond),
  ];
}

/** Soft-deletes the untouched live items with these Plaid ids; each with its `delete`. */
export function removePendingStmts(db: Db, b: Base, plaidIds: readonly string[]) {
  const cond = sql`budget_id = ${b.budgetId} and deleted_at is null and entered_transaction_id is null and plaid_transaction_id in (select value from json_each(${JSON.stringify(plaidIds)}))`;
  return [
    logSelectStmt(
      db,
      {
        budgetId: b.budgetId,
        actor: b.actor,
        action: "delete",
        entityType: "pending_transaction",
        createdAt: b.now,
      },
      sql`select * from pending_transactions where ${cond}`,
      { entityId: sql`id`, before: ownLog(), after: null },
    ),
    db.update(p).set({ deletedAt: b.now, updatedAt: b.now }).where(cond),
  ];
}

/**
 * Marks the items an Enter Now consumed as resolved by the bank (posted or withdrawn): an undo of that Enter Now is
 * then stale. `guard` (optional) must hold too.
 */
export function resolveEnteredStmt(
  db: Db,
  budgetId: string,
  plaidIds: readonly string[],
  now: string,
  guard?: SQLWrapper,
) {
  return db
    .update(p)
    .set({ resolvedAt: now, updatedAt: now })
    .where(
      sql`budget_id = ${budgetId} and deleted_at is not null and entered_transaction_id is not null and resolved_at is null
        and plaid_transaction_id in (select value from json_each(${JSON.stringify(plaidIds)}))
        ${guard ? sql`and exists ${guard}` : sql``}`,
    );
}

/** A posted import replaces an untouched pending item: soft-delete it, while it is as read and `guard` holds. */
export function replacePendingStmts(
  db: Db,
  b: Base,
  row: PendingRow,
  replacedBy: string,
  guard: SQLWrapper,
) {
  const cond = sql`id = ${row.id} and deleted_at is null and entered_transaction_id is null and updated_at = ${row.updatedAt} and exists ${guard}`;
  return [
    logSelectStmt(
      db,
      {
        budgetId: b.budgetId,
        actor: b.actor,
        action: "delete",
        entityType: "pending_transaction",
        createdAt: b.now,
      },
      sql`select * from pending_transactions where ${cond}`,
      {
        entityId: sql`id`,
        before: ownLog(),
        after: sql`json_object('replaced_by', ${replacedBy})`,
      },
    ),
    db.update(p).set({ deletedAt: b.now, updatedAt: b.now }).where(cond),
  ];
}

/** Enter Now: soft-delete the item and point it at the row it became. */
export function softDeleteForEnterStmt(db: Db, id: string, enteredId: string, now: string) {
  return db
    .update(p)
    .set({ deletedAt: now, updatedAt: now, enteredTransactionId: enteredId })
    .where(and(eq(p.id, id), isNull(p.deletedAt)));
}

/**
 * A statement that fails the whole batch (NOT NULL on `change_log.entity_type`) unless the item is still live with
 * this `updated_at`: a sync replaced, removed or changed it meanwhile. `isPendingChanged` recognises it.
 */
export function pendingLiveCheck(db: Db, id: string, updatedAt: string) {
  return insertSelect(
    db,
    changeLog,
    {
      id: sql`'pending-changed'`,
      budgetId: sql`null`,
      actor: sql`'check'`,
      action: sql`'update'`,
      entityType: sql`null`,
      entityId: sql`'pending-changed'`,
      createdAt: sql`''`,
      changeSetId: currentChangeSetId(),
    },
    sql`where not exists (select 1 from pending_transactions where id = ${id} and deleted_at is null and updated_at = ${updatedAt})`,
  );
}

export function isPendingChanged(e: unknown): boolean {
  for (let x: unknown = e; x instanceof Error; x = x.cause) {
    if (x.message.includes("NOT NULL constraint failed: change_log.entity_type")) return true;
  }
  return false;
}

/** The change_log shape of a pending item (Enter Now's `before`). */
export const pendingLogShape = (r: PendingRow) => ({
  account_id: r.accountId,
  date: r.date,
  amount: r.amount,
  payee_name: r.payeeName,
  imported_payee: r.importedPayee,
  bank_description: r.bankDescription,
  plaid_transaction_id: r.plaidTransactionId,
  resolved_at: r.resolvedAt,
});
