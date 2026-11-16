import { and, asc, eq, inArray, isNull, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { bankAccounts } from "../db/schema/bank-accounts";
import { transactions } from "../db/schema/transactions";

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
      sql`select ${r.id}, ${r.budgetId}, ${r.name}, ${r.type}, ${r.onBudget ? 1 : 0}, ${r.note}, ${r.starred ? 1 : 0}, ${r.closed ? 1 : 0}, ${r.sortOrder}, ${r.createdAt}, ${r.deletedAt}, ${r.bankAccountId}, ${r.importStartDate} where exists ${sortIsNext(db, r.budgetId, r.sortOrder)}`,
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

/** Inserts the row only while `guard` holds. Column order is the table's. */
export function insertIfStmt(db: Db, row: AccountRow, guard: SQLWrapper) {
  const r = row;
  return db
    .insert(accounts)
    .select(
      sql`select ${r.id}, ${r.budgetId}, ${r.name}, ${r.type}, ${r.onBudget ? 1 : 0}, ${r.note}, ${r.starred ? 1 : 0}, ${r.closed ? 1 : 0}, ${r.sortOrder}, ${r.createdAt}, ${r.deletedAt}, ${r.bankAccountId}, ${r.importStartDate} where exists ${guard}`,
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

/** bank account id → account id, for the plan's active accounts linked to one of `bankAccountIds`. */
export async function linksForPlan(
  db: Db,
  budgetId: string,
  bankAccountIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (bankAccountIds.length === 0) return out;
  const rows = await db
    .select({ id: accounts.id, bank: accounts.bankAccountId })
    .from(accounts)
    .where(
      and(
        eq(accounts.budgetId, budgetId),
        isNull(accounts.deletedAt),
        inArray(accounts.bankAccountId, bankAccountIds),
      ),
    );
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
export async function latestReconciledDate(db: Db, accountId: string): Promise<string | null> {
  const [r] = await db
    .select({ d: sql<string | null>`max(${transactions.date})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.cleared, "reconciled"),
        isNull(transactions.deletedAt),
      ),
    );
  return r?.d ?? null;
}

function linkCondition(before: AccountRow, bankAccountId: string) {
  return and(
    eq(accounts.id, before.id),
    isNull(accounts.deletedAt),
    isNull(accounts.bankAccountId),
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
    .set({ bankAccountId, importStartDate })
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
    .set({ bankAccountId: null, importStartDate: null })
    .where(unlinkCondition(before));
}

const ofConnection = (connectionId: string) =>
  sql`select ${bankAccounts.id} from ${bankAccounts} where ${bankAccounts.bankConnectionId} = ${connectionId}`;

/** Every account row (any plan) linked to a bank account of the connection. */
export async function linkedToConnection(db: Db, connectionId: string): Promise<AccountRow[]> {
  return db
    .select()
    .from(accounts)
    .where(
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
