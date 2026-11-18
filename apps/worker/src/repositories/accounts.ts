import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { bankAccounts } from "../db/schema/bank-accounts";
import { bankConnections } from "../db/schema/bank-connections";
import { budgets } from "../db/schema/budgets";
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";
import { insertSelect } from "./insert-select";
import { countsInBalance } from "./transactions";

export type AccountRow = typeof accounts.$inferSelect;
/** An account with its bank connection's status and last sync (null when not linked), read in the same statement. */
export type AccountReadRow = AccountRow & {
  connectionStatus: string | null;
  connectionErrorCode: string | null;
  connectionSyncedAt: string | null;
};

/** The accounts table with the linked connection's status and sync time joined in. */
function selectWithLink(db: Db) {
  return db
    .select({
      ...getTableColumns(accounts),
      connectionStatus: bankConnections.status,
      connectionErrorCode: bankConnections.syncErrorCode,
      connectionSyncedAt: bankConnections.lastSyncedAt,
    })
    .from(accounts)
    .leftJoin(bankAccounts, eq(bankAccounts.id, accounts.bankAccountId))
    .leftJoin(bankConnections, eq(bankConnections.id, bankAccounts.bankConnectionId));
}

export async function findActive(
  db: Db,
  budgetId: string,
  id: string,
): Promise<AccountReadRow | undefined> {
  const [row] = await selectWithLink(db)
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
  return insertSelect(
    db,
    accounts,
    {
      id: r.id,
      budgetId: r.budgetId,
      name: r.name,
      type: r.type,
      onBudget: r.onBudget ? 1 : 0,
      note: r.note,
      starred: r.starred ? 1 : 0,
      closed: r.closed ? 1 : 0,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt,
      deletedAt: r.deletedAt,
      bankAccountId: r.bankAccountId,
      importStartDate: r.importStartDate,
      lastReconciledAt: r.lastReconciledAt,
      linkMissingSince: r.linkMissingSince,
    },
    sql`where exists ${sortIsNext(db, r.budgetId, r.sortOrder)}`,
  );
}

/** The plan's non-deleted accounts in display order (`sort_order`, then id). */
export async function list(
  db: Db,
  budgetId: string,
  opts: { includeClosed: boolean },
): Promise<AccountReadRow[]> {
  const conds = [eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)];
  if (!opts.includeClosed) conds.push(eq(accounts.closed, false));
  return selectWithLink(db)
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

/** True when another non-deleted account of the plan has this name, ignoring ASCII case. */
export async function nameTakenByOther(
  db: Db,
  budgetId: string,
  accountId: string,
  name: string,
): Promise<boolean> {
  const [r] = await db
    .select({ x: sql`1` })
    .from(accounts)
    .where(
      and(
        eq(accounts.budgetId, budgetId),
        isNull(accounts.deletedAt),
        sql`${accounts.id} <> ${accountId}`,
        sql`lower(${accounts.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  return r !== undefined;
}

/** `SELECT 1` that holds while `sort` is the next free sort_order and no account of the plan has this name. */
export function newAccountGuard(
  db: Db,
  budgetId: string,
  sort: number,
  name: string,
  bankAccountId: string | null = null,
) {
  const link =
    bankAccountId === null
      ? sql``
      : sql` and exists (select 1 from ${bankAccounts} where ${bankAccounts.id} = ${bankAccountId}) and not exists (select 1 from ${accounts} a2 where a2.budget_id = ${budgetId} and a2.deleted_at is null and a2.bank_account_id = ${bankAccountId})`;
  return db
    .select({ x: sql`1` })
    .from(sql`(select 1)`)
    .where(
      sql`(select coalesce(max(${accounts.sortOrder}), -1) + 1 from ${accounts} where ${accounts.budgetId} = ${budgetId} and ${accounts.deletedAt} is null) = ${sort} and not exists (select 1 from ${accounts} where ${accounts.budgetId} = ${budgetId} and ${accounts.deletedAt} is null and lower(${accounts.name}) = lower(${name}))${link}`,
    );
}

/** Inserts the row only while `guard` holds. */
export function insertIfStmt(db: Db, row: AccountRow, guard: SQLWrapper) {
  const r = row;
  return insertSelect(
    db,
    accounts,
    {
      id: r.id,
      budgetId: r.budgetId,
      name: r.name,
      type: r.type,
      onBudget: r.onBudget ? 1 : 0,
      note: r.note,
      starred: r.starred ? 1 : 0,
      closed: r.closed ? 1 : 0,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt,
      deletedAt: r.deletedAt,
      bankAccountId: r.bankAccountId,
      importStartDate: r.importStartDate,
      lastReconciledAt: r.lastReconciledAt,
      linkMissingSince: r.linkMissingSince,
    },
    sql`where exists ${guard}`,
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

/** Per account: its active transaction count and the id of the active one that is its Starting Balance. */
export async function transactionFacts(
  db: Db,
  budgetId: string,
  accountId?: string,
): Promise<Map<string, { count: number; startingId: string | null }>> {
  const conds = [eq(transactions.budgetId, budgetId), countsInBalance()];
  if (accountId) conds.push(eq(transactions.accountId, accountId));
  const rows = await db
    .select({
      accountId: transactions.accountId,
      count: sql<number>`count(*)`,
      startingId: sql<
        string | null
      >`max(case when ${payees.system} = 'starting_balance' then ${transactions.id} end)`,
    })
    .from(transactions)
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(and(...conds))
    .groupBy(transactions.accountId);
  return new Map(rows.map((r) => [r.accountId, { count: r.count, startingId: r.startingId }]));
}

/** `SELECT 1` that holds once a transaction row exists. */
export function transactionExistsStmt(db: Db, id: string) {
  return db.select({ x: sql`1` }).from(transactions).where(eq(transactions.id, id));
}

/** A condition: the account's active transactions sum to `amount`. */
export function accountSumIs(accountId: string, amount: number): SQL {
  return sql`(select coalesce(sum(${transactions.amount}), 0) from ${transactions} where ${transactions.accountId} = ${accountId} and ${countsInBalance()}) = ${amount}`;
}

/** A condition: the account has no active transaction other than `exceptId`. */
export function noOtherTransactions(accountId: string, exceptId: string | null): SQL {
  return exceptId === null
    ? sql`not exists (select 1 from ${transactions} where ${transactions.accountId} = ${accountId} and ${countsInBalance()})`
    : sql`not exists (select 1 from ${transactions} where ${transactions.accountId} = ${accountId} and ${countsInBalance()} and ${transactions.id} <> ${exceptId})`;
}

/** A condition: no other non-deleted account of the plan has this name, ignoring ASCII case. */
export function nameFree(budgetId: string, accountId: string, name: string): SQL {
  return sql`not exists (select 1 from ${accounts} a2 where a2.budget_id = ${budgetId} and a2.deleted_at is null and a2.id <> ${accountId} and lower(a2.name) = lower(${name}))`;
}

/** Holds while the account is active and still has the name, note, star, closed flag and link of `before`. */
function holdsCondition(before: AccountRow) {
  return and(
    eq(accounts.id, before.id),
    isNull(accounts.deletedAt),
    eq(accounts.name, before.name),
    before.note === null ? isNull(accounts.note) : eq(accounts.note, before.note),
    eq(accounts.starred, before.starred),
    eq(accounts.closed, before.closed),
    before.bankAccountId === null
      ? isNull(accounts.bankAccountId)
      : eq(accounts.bankAccountId, before.bankAccountId),
  );
}

/** A `SELECT 1` that holds while `holdsCondition(before)` and `extra` do. */
export function accountHolds(db: Db, before: AccountRow, extra?: SQL) {
  return db
    .select({ x: sql`1` })
    .from(accounts)
    .where(extra ? and(holdsCondition(before), extra) : holdsCondition(before));
}

export function updateFieldsIfStmt(
  db: Db,
  before: AccountRow,
  set: { name?: string; note?: string | null; starred?: boolean },
  extra?: SQL,
) {
  return db
    .update(accounts)
    .set(set)
    .where(extra ? and(holdsCondition(before), extra) : holdsCondition(before));
}

/** Closes, unstars and unlinks the account while it still holds and `extra` does. */
export function closeIfStmt(db: Db, before: AccountRow, extra: SQL) {
  return db
    .update(accounts)
    .set({
      closed: true,
      starred: false,
      bankAccountId: null,
      importStartDate: null,
      linkMissingSince: null,
    })
    .where(and(holdsCondition(before), extra));
}

/** Sets the reconcile marker while the account holds as read and `extra` does. */
export function markReconciledStmt(db: Db, before: AccountRow, now: string, extra: SQL) {
  return db
    .update(accounts)
    .set({ lastReconciledAt: now })
    .where(and(holdsCondition(before), extra));
}

export function reopenIfStmt(db: Db, before: AccountRow) {
  return db.update(accounts).set({ closed: false }).where(holdsCondition(before));
}

/**
 * Soft-deletes a Starting Balance transaction of the account (the one write to `transactions` kept here),
 * only while the account still holds as read and `extra` does, like the change_log row it goes with.
 */
export function softDeleteStartingBalanceStmt(
  db: Db,
  before: AccountRow,
  txId: string,
  at: string,
  extra: SQL,
) {
  return db
    .update(transactions)
    .set({ deletedAt: at, updatedAt: at })
    .where(
      and(
        eq(transactions.id, txId),
        eq(transactions.accountId, before.id),
        isNull(transactions.deletedAt),
        sql`exists ${accountHolds(db, before, extra)}`,
      ),
    );
}

/** Soft-deletes and unlinks the account while it still holds and `extra` does. */
export function softDeleteIfStmt(db: Db, before: AccountRow, at: string, extra: SQL) {
  return db
    .update(accounts)
    .set({ deletedAt: at, bankAccountId: null, importStartDate: null, linkMissingSince: null })
    .where(and(holdsCondition(before), extra));
}

/** `SELECT 1` that holds once the account row exists. */
export function existsStmt(db: Db, id: string) {
  return db.select({ x: sql`1` }).from(accounts).where(eq(accounts.id, id));
}

/**
 * bank account id → account id, for the plan's active accounts linked to one of `bankAccountIds`.
 * `bankAccountIds` is the request's list, at most 50 (`AccountsFromBankRequest`), so 51 parameters.
 */
export async function linksForPlan(
  db: Db,
  budgetId: string,
  bankAccountIds: string[],
): Promise<Map<string, string>> {
  if (bankAccountIds.length === 0) return new Map();
  return linksWhere(db, budgetId, inArray(accounts.bankAccountId, bankAccountIds));
}

/** bank account id → account id: the plan's live accounts linked to a bank account of `environment`. Binds 2 parameters. */
export async function linksInEnvironment(
  db: Db,
  budgetId: string,
  environment: "production" | "sandbox",
): Promise<Map<string, string>> {
  return linksWhere(
    db,
    budgetId,
    sql`${accounts.bankAccountId} in (select ${bankAccounts.id} from ${bankAccounts} join ${bankConnections} on ${bankConnections.id} = ${bankAccounts.bankConnectionId} where ${bankConnections.environment} = ${environment})`,
  );
}

/** The same for the bank accounts of one connection. Binds 2 parameters. */
export async function linksOfConnection(
  db: Db,
  budgetId: string,
  connectionId: string,
): Promise<Map<string, string>> {
  return linksWhere(
    db,
    budgetId,
    sql`${accounts.bankAccountId} in (${ofConnection(connectionId)})`,
  );
}

async function linksWhere(db: Db, budgetId: string, cond: SQL): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = await db
    .select({ id: accounts.id, bank: accounts.bankAccountId })
    .from(accounts)
    .where(and(eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt), cond));
  for (const r of rows) if (r.bank) out.set(r.bank, r.id);
  return out;
}

export async function findByBankAccount(
  db: Db,
  budgetId: string,
  bankAccountId: string,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.budgetId, budgetId),
        isNull(accounts.deletedAt),
        eq(accounts.bankAccountId, bankAccountId),
      ),
    )
    .limit(1);
  return row;
}

/** The latest date of the account's active reconciled transactions, or null. */
export function latestReconciledDateQuery(db: Db, accountId: string) {
  return db
    .select({ d: sql<string | null>`max(${transactions.date})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.cleared, "reconciled"),
        countsInBalance(),
      ),
    );
}

export async function latestReconciledDate(db: Db, accountId: string): Promise<string | null> {
  return (await latestReconciledDateQuery(db, accountId))[0]?.d ?? null;
}

function linkCondition(before: AccountRow, bankAccountId: string) {
  return and(
    eq(accounts.id, before.id),
    isNull(accounts.deletedAt),
    // Free, or linked to a bank account the bank no longer lists (a relink replaces it).
    before.bankAccountId === null
      ? isNull(accounts.bankAccountId)
      : and(eq(accounts.bankAccountId, before.bankAccountId), isNotNull(accounts.linkMissingSince)),
    eq(accounts.closed, false),
    eq(accounts.type, before.type),
    sql`exists (select 1 from ${bankAccounts} where ${bankAccounts.id} = ${bankAccountId})`,
    sql`not exists (select 1 from ${accounts} a2 where a2.budget_id = ${before.budgetId} and a2.deleted_at is null and a2.bank_account_id = ${bankAccountId})`,
  );
}

/** A `SELECT 1` that holds while the account can still be linked to the bank account. */
export function linkHolds(db: Db, before: AccountRow, bankAccountId: string) {
  return db.select({ x: sql`1` }).from(accounts).where(linkCondition(before, bankAccountId));
}

export function setLinkIfStmt(
  db: Db,
  before: AccountRow,
  bankAccountId: string,
  importStartDate: string,
) {
  return db
    .update(accounts)
    .set({ bankAccountId, importStartDate, linkMissingSince: null })
    .where(linkCondition(before, bankAccountId));
}

function unlinkCondition(before: AccountRow) {
  return and(
    eq(accounts.id, before.id),
    isNull(accounts.deletedAt),
    before.bankAccountId === null
      ? isNull(accounts.bankAccountId)
      : eq(accounts.bankAccountId, before.bankAccountId),
  );
}

/** A `SELECT 1` that holds while the account is still linked to the bank account of `before`. */
export function unlinkHolds(db: Db, before: AccountRow) {
  return db.select({ x: sql`1` }).from(accounts).where(unlinkCondition(before));
}

export function unlinkIfStmt(db: Db, before: AccountRow) {
  return db
    .update(accounts)
    .set({ bankAccountId: null, importStartDate: null, linkMissingSince: null })
    .where(unlinkCondition(before));
}

function importStartCondition(before: AccountRow, value: string | null) {
  return and(
    eq(accounts.id, before.id),
    isNull(accounts.deletedAt),
    before.bankAccountId === null
      ? isNull(accounts.bankAccountId)
      : eq(accounts.bankAccountId, before.bankAccountId),
    value === null ? isNull(accounts.importStartDate) : eq(accounts.importStartDate, value),
  );
}

/** SELECT 1 while the account is live, linked to before.bankAccountId and has before.importStartDate (IS). */
export function importStartHolds(db: Db, before: AccountRow) {
  return db
    .select({ x: sql`1` })
    .from(accounts)
    .where(importStartCondition(before, before.importStartDate));
}

/** SELECT 1 while the account is live, linked to before.bankAccountId and has import_start_date = value. */
export function importStartIs(db: Db, before: AccountRow, value: string) {
  return db.select({ x: sql`1` }).from(accounts).where(importStartCondition(before, value));
}

/** UPDATE accounts SET import_start_date = next while the account holds as read and the guard does. */
export function setImportStartIfStmt(db: Db, before: AccountRow, next: string, guard: SQLWrapper) {
  return db
    .update(accounts)
    .set({ importStartDate: next })
    .where(and(importStartCondition(before, before.importStartDate), sql`exists ${guard}`));
}

const ofConnection = (connectionId: string) =>
  sql`select ${bankAccounts.id} from ${bankAccounts} where ${bankAccounts.bankConnectionId} = ${connectionId}`;

/** Every account row (any plan) linked to a bank account of the connection. */
export async function linkedToConnection(db: Db, connectionId: string): Promise<AccountReadRow[]> {
  return selectWithLink(db).where(
    and(
      isNull(accounts.deletedAt),
      sql`${accounts.bankAccountId} in (${ofConnection(connectionId)})`,
    ),
  );
}

/** A condition that holds while no active account is linked to any of the connection's bank accounts. */
export function noLinksToConnection(connectionId: string) {
  return sql`not exists (select 1 from ${accounts} where ${accounts.deletedAt} is null and ${accounts.bankAccountId} in (${ofConnection(connectionId)}))`;
}

/** The earliest date of the account's live Starting Balance rows, or null. */
export function startingBalanceDateQuery(db: Db, accountId: string) {
  return db
    .select({ d: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .innerJoin(payees, eq(payees.id, transactions.payeeId))
    .where(
      and(
        eq(transactions.accountId, accountId),
        countsInBalance(),
        eq(payees.system, "starting_balance"),
      ),
    );
}

export async function startingBalanceDate(db: Db, accountId: string): Promise<string | null> {
  return (await startingBalanceDateQuery(db, accountId))[0]?.d ?? null;
}

/** The plan's live accounts linked to a bank account, with the link columns (as linkedToConnection). */
export async function linkedInPlan(db: Db, budgetId: string): Promise<AccountReadRow[]> {
  return selectWithLink(db).where(
    and(
      eq(accounts.budgetId, budgetId),
      isNull(accounts.deletedAt),
      sql`${accounts.bankAccountId} is not null`,
    ),
  );
}

/** D1 allows 100 bound parameters a statement; `linksAsRead` binds one per row plus the plan's id. */
export const MAX_LINKS_AS_READ = 90;

/**
 * Holds while no live account of the plan is linked except the (id, bank account) pairs read: a link made
 * since the read (or a link changed to another bank account) makes it false. At most MAX_LINKS_AS_READ rows.
 */
export function linksAsRead(
  budgetId: string,
  rows: Pick<AccountRow, "id" | "bankAccountId">[],
): SQL {
  const known = rows.length
    ? sql` and (${accounts.id} || '|' || ${accounts.bankAccountId}) not in (${sql.join(
        rows.map((r) => sql`${`${r.id}|${r.bankAccountId}`}`),
        sql`, `,
      )})`
    : sql``;
  return sql`not exists (select 1 from ${accounts} where ${accounts.budgetId} = ${budgetId} and ${accounts.deletedAt} is null and ${accounts.bankAccountId} is not null${known})`;
}

/**
 * Sets `link_missing_since` (kept if already set) on the live accounts linked to a bank account of the
 * connection that is in `missingBankIds`, and clears it on those that are not, while `guard` holds. Only
 * rows that change are written; it is sync state like the balances (no change_log row, no updated_at).
 */
export function markMissingStmt(
  db: Db,
  connectionId: string,
  missingBankIds: string[],
  now: string,
  guard: SQLWrapper,
) {
  const missing =
    missingBankIds.length > 0
      ? sql`${accounts.bankAccountId} in (${sql.join(
          missingBankIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`0`;
  return db
    .update(accounts)
    .set({
      linkMissingSince: sql`case when ${missing} then coalesce(${accounts.linkMissingSince}, ${now}) else null end`,
    })
    .where(
      and(
        isNull(accounts.deletedAt),
        sql`${accounts.bankAccountId} in (${ofConnection(connectionId)})`,
        sql`(${accounts.linkMissingSince} is null) = (${missing})`,
        sql`exists ${guard}`,
      ),
    );
}

/** The unlink of a plan's delete holds while the account is still linked as read and the plan's deleted_at is `at`. */
function unlinkAfterDeleteCondition(before: AccountRow, at: string) {
  return and(
    unlinkCondition(before),
    sql`exists (select 1 from ${budgets} where ${budgets.id} = ${before.budgetId} and ${budgets.deletedAt} = ${at})`,
  );
}

/** SELECT 1 while `before` is still linked as read and the plan's deleted_at = at. */
export function unlinkAfterDeleteHolds(db: Db, before: AccountRow, at: string) {
  return db.select({ x: sql`1` }).from(accounts).where(unlinkAfterDeleteCondition(before, at));
}

/** UPDATE accounts SET bank_account_id = NULL, import_start_date = NULL under the same condition. */
export function unlinkAfterDeleteStmt(db: Db, before: AccountRow, at: string) {
  return db
    .update(accounts)
    .set({ bankAccountId: null, importStartDate: null, linkMissingSince: null })
    .where(unlinkAfterDeleteCondition(before, at));
}
