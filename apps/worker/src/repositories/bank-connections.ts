import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client";
import { bankAccounts } from "../db/schema/bank-accounts";
import { bankConnections } from "../db/schema/bank-connections";
import { secrets } from "../db/schema/secrets";
import { accessTokenSecretName } from "../plaid/tokens";
import { insertSelect } from "./insert-select";

export type BankConnectionRow = typeof bankConnections.$inferSelect;
export type BankAccountRow = typeof bankAccounts.$inferSelect;

/** Newest first; the accounts come from one extra query. */
export async function listByEnvironment(
  db: Db,
  environment: "production" | "sandbox",
): Promise<{ row: BankConnectionRow; accounts: BankAccountRow[] }[]> {
  const rows = await db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.environment, environment))
    .orderBy(desc(bankConnections.createdAt), desc(bankConnections.id));
  if (rows.length === 0) return [];
  const accounts = await db
    .select()
    .from(bankAccounts)
    .where(
      inArray(
        bankAccounts.bankConnectionId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(bankAccounts.createdAt, bankAccounts.name);
  return rows.map((row) => ({
    row,
    accounts: accounts.filter((a) => a.bankConnectionId === row.id),
  }));
}

export function insertConnectionStmt(db: Db, row: BankConnectionRow) {
  return db.insert(bankConnections).values(row);
}

export function insertAccountStmt(db: Db, row: BankAccountRow) {
  return db.insert(bankAccounts).values(row);
}

/** Adds a bank account the bank lists while `guard` holds; a row for the same Plaid account stays as it is. */
export function insertAccountIfStmt(db: Db, row: BankAccountRow, guard: SQLWrapper) {
  return insertSelect(
    db,
    bankAccounts,
    {
      id: row.id,
      bankConnectionId: row.bankConnectionId,
      plaidAccountId: row.plaidAccountId,
      name: row.name,
      mask: row.mask,
      type: row.type,
      subtype: row.subtype,
      currentBalance: row.currentBalance,
      availableBalance: row.availableBalance,
      balanceUpdatedAt: row.balanceUpdatedAt,
      createdAt: row.createdAt,
    },
    sql`where exists ${guard}`,
  ).onConflictDoNothing();
}

/** Removes bank accounts the bank no longer lists that no plan account is linked to, while `guard` holds. */
export function deleteUnlistedStmt(
  db: Db,
  connectionId: string,
  bankAccountIds: string[],
  guard: SQLWrapper,
) {
  return db
    .delete(bankAccounts)
    .where(
      and(
        eq(bankAccounts.bankConnectionId, connectionId),
        inArray(bankAccounts.id, bankAccountIds),
        sql`not exists (select 1 from accounts a where a.bank_account_id = ${bankAccounts.id})`,
        sql`exists ${guard}`,
      ),
    );
}

export async function getInEnvironment(
  db: Db,
  environment: "production" | "sandbox",
  id: string,
): Promise<{ row: BankConnectionRow; accounts: BankAccountRow[] } | null> {
  const [row] = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.id, id), eq(bankConnections.environment, environment)))
    .limit(1);
  if (!row) return null;
  const accounts = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.bankConnectionId, id))
    .orderBy(bankAccounts.createdAt, bankAccounts.name);
  return { row, accounts };
}

/** The guard for `changeLogInsertIf`. */
export function connectionExists(db: Db, id: string) {
  return db.select({ one: sql`1` }).from(bankConnections).where(eq(bankConnections.id, id));
}

export function updateConnectionStmt(
  db: Db,
  id: string,
  set: Partial<
    Pick<
      BankConnectionRow,
      | "nickname"
      | "status"
      | "lastResetAt"
      | "updatedAt"
      | "syncCursor"
      | "lastSyncedAt"
      | "syncErrorSince"
      | "syncAccounts"
      | "syncLoopCursor"
      | "syncFailedAt"
      | "syncErrorCode"
      | "loginCheckedAt"
    >
  >,
  guard?: SQLWrapper,
) {
  return db
    .update(bankConnections)
    .set(set)
    .where(and(eq(bankConnections.id, id), guard ? sql`exists ${guard}` : undefined));
}

/** Holds while the connection exists and needs no repair (login_required, broken): a failed run may say so. */
export function failureMayBeRecorded(db: Db, id: string): SQLWrapper {
  return db
    .select({ one: sql`1` })
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.id, id),
        notInArray(bankConnections.status, ["login_required", "broken"]),
      ),
    );
}

/** A `SELECT 1` that holds while the connection's `sync_cursor` is still `cursor` (null-safe). */
export function cursorIs(db: Db, id: string, cursor: string | null) {
  return db
    .select({ one: sql`1` })
    .from(bankConnections)
    .where(and(eq(bankConnections.id, id), sql`${bankConnections.syncCursor} is ${cursor}`));
}

export async function findById(db: Db, id: string): Promise<BankConnectionRow | undefined> {
  const [r] = await db.select().from(bankConnections).where(eq(bankConnections.id, id)).limit(1);
  return r;
}

export async function accountsOf(db: Db, connectionId: string): Promise<BankAccountRow[]> {
  return db.select().from(bankAccounts).where(eq(bankAccounts.bankConnectionId, connectionId));
}

/** Writes the bank account's balances while `guard` holds. */
export function updateBalancesStmt(
  db: Db,
  bankAccountId: string,
  b: { current: number | null; available: number | null; at: string },
  guard?: SQLWrapper,
  names?: { name: string; mask: string | null },
) {
  return db
    .update(bankAccounts)
    .set({
      currentBalance: b.current,
      availableBalance: b.available,
      balanceUpdatedAt: b.at,
      ...(names ?? {}),
    })
    .where(and(eq(bankAccounts.id, bankAccountId), guard ? sql`exists ${guard}` : undefined));
}

/** Connections the schedule may sync: not needing a repair, never synced or last synced at or before `before`. */
export async function listDue(db: Db, before: string): Promise<BankConnectionRow[]> {
  return db
    .select()
    .from(bankConnections)
    .where(
      and(
        notInArray(bankConnections.status, ["login_required", "broken"]),
        or(isNull(bankConnections.lastSyncedAt), lte(bankConnections.lastSyncedAt, before)),
      ),
    )
    .orderBy(bankConnections.createdAt, bankConnections.id);
}

/** Records the time of a scheduled check that got an error (the one write of a refused check). */
export function checkedStmt(db: Db, id: string, at: string) {
  return db
    .update(bankConnections)
    .set({ loginCheckedAt: at })
    .where(and(eq(bankConnections.id, id), eq(bankConnections.status, "login_required")));
}

/**
 * The connections that need a sign-in and may be checked again: never checked, or last checked at or before
 * `before`. Never-checked first, then the oldest check.
 */
export async function listToCheck(
  db: Db,
  before: string,
  limit: number,
): Promise<BankConnectionRow[]> {
  return db
    .select()
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.status, "login_required"),
        or(isNull(bankConnections.loginCheckedAt), lte(bankConnections.loginCheckedAt, before)),
      ),
    )
    .orderBy(
      sql`${bankConnections.loginCheckedAt} is not null`,
      bankConnections.loginCheckedAt,
      bankConnections.createdAt,
      bankConnections.id,
    )
    .limit(limit);
}

/** Connections of the environment with a bank account linked to a live account of the plan. */
export async function listForPlanLinks(
  db: Db,
  budgetId: string,
  environment: "production" | "sandbox",
): Promise<BankConnectionRow[]> {
  return db
    .select()
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.environment, environment),
        sql`exists (select 1 from accounts a join bank_accounts b on b.id = a.bank_account_id where b.bank_connection_id = ${bankConnections.id} and a.budget_id = ${budgetId} and a.deleted_at is null)`,
      ),
    )
    .orderBy(bankConnections.createdAt, bankConnections.id);
}

export function deleteAccountsStmt(db: Db, connectionId: string, guard?: SQLWrapper) {
  return db
    .delete(bankAccounts)
    .where(
      and(
        eq(bankAccounts.bankConnectionId, connectionId),
        guard ? sql`exists ${guard}` : undefined,
      ),
    );
}

export function deleteConnectionStmt(db: Db, id: string, guard?: SQLWrapper) {
  return db
    .delete(bankConnections)
    .where(and(eq(bankConnections.id, id), guard ? sql`exists ${guard}` : undefined));
}

/** `SELECT 1` that holds while the connection exists and `condition` (no link made since the read) holds. */
export function removalHolds(db: Db, id: string, condition: SQLWrapper) {
  return db
    .select({ one: sql`1` })
    .from(bankConnections)
    .where(and(eq(bankConnections.id, id), sql`${condition}`));
}

/** Deletes the connection's stored token once the connection row is gone (so a lost guard keeps it). */
export function deleteTokenWhenGoneStmt(db: Db, connectionId: string) {
  return db
    .delete(secrets)
    .where(
      and(
        eq(secrets.name, accessTokenSecretName(connectionId)),
        sql`not exists (select 1 from ${bankConnections} where ${bankConnections.id} = ${connectionId})`,
      ),
    );
}

/** The bank account when its connection is of `environment`; another environment's is not found. */
export async function findBankAccountInEnvironment(
  db: Db,
  environment: "production" | "sandbox",
  bankAccountId: string,
): Promise<
  | (BankAccountRow & {
      connectionStatus: string;
      connectionSyncedAt: string | null;
      connectionErrorCode: string | null;
    })
  | undefined
> {
  const [r] = await db
    .select({
      a: bankAccounts,
      s: bankConnections.status,
      t: bankConnections.lastSyncedAt,
      e: bankConnections.syncErrorCode,
    })
    .from(bankAccounts)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccounts.bankConnectionId))
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankConnections.environment, environment)))
    .limit(1);
  return r && { ...r.a, connectionStatus: r.s, connectionSyncedAt: r.t, connectionErrorCode: r.e };
}

export async function findBankAccountById(db: Db, id: string): Promise<BankAccountRow | undefined> {
  const [r] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
  return r;
}
