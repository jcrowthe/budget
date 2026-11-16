import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { bankAccounts } from "../db/schema/bank-accounts";
import { bankConnections } from "../db/schema/bank-connections";

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
  set: Partial<Pick<BankConnectionRow, "nickname" | "status" | "lastResetAt" | "updatedAt">>,
) {
  return db.update(bankConnections).set(set).where(eq(bankConnections.id, id));
}

export function deleteAccountsStmt(db: Db, connectionId: string) {
  return db.delete(bankAccounts).where(eq(bankAccounts.bankConnectionId, connectionId));
}

export function deleteConnectionStmt(db: Db, id: string) {
  return db.delete(bankConnections).where(eq(bankConnections.id, id));
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
