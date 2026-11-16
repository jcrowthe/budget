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
    >
  >,
  guard?: SQLWrapper,
) {
  return db
    .update(bankConnections)
    .set(set)
    .where(and(eq(bankConnections.id, id), guard ? sql`exists ${guard}` : undefined));
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
) {
  return db
    .update(bankAccounts)
    .set({ currentBalance: b.current, availableBalance: b.available, balanceUpdatedAt: b.at })
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
): Promise<BankAccountRow | undefined> {
  const [r] = await db
    .select({ a: bankAccounts })
    .from(bankAccounts)
    .innerJoin(bankConnections, eq(bankConnections.id, bankAccounts.bankConnectionId))
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankConnections.environment, environment)))
    .limit(1);
  return r?.a;
}

export async function findBankAccountById(db: Db, id: string): Promise<BankAccountRow | undefined> {
  const [r] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
  return r;
}
