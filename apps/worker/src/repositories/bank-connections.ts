import { desc, eq, inArray } from "drizzle-orm";
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
