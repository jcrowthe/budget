import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { changeLog } from "../db/schema/change-log";
import { transactions } from "../db/schema/transactions";
import { insertSelect } from "./insert-select";
import { countsInBalance } from "./transactions";

/** A condition: the account's cleared (and reconciled) sum equals `amount`, as `balancesByAccount` counts it. */
export function clearedSumIs(accountId: string, amount: number): SQL {
  return sql`(select coalesce(sum(${transactions.amount}), 0) from ${transactions} where ${transactions.accountId} = ${accountId} and ${countsInBalance()} and ${transactions.cleared} in ('cleared', 'reconciled')) = ${amount}`;
}

/** The rows a reconcile flips: the account's live `cleared` rows. */
function clearedRows(accountId: string): SQL {
  return sql`${transactions.accountId} = ${accountId} and ${transactions.cleared} = 'cleared' and ${countsInBalance()}`;
}

/** One `update` log row per cleared row, written while `guard` holds. Run it before the flags statement. */
export function reconcileLogsStmt(
  db: Db,
  p: { budgetId: string; accountId: string; actor: string; now: string; guard: SQLWrapper },
) {
  const uuid = sql`lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))`;
  return insertSelect(
    db,
    changeLog,
    {
      id: uuid,
      budgetId: transactions.budgetId,
      actor: p.actor,
      action: sql`'update'`,
      entityType: sql`'transaction'`,
      entityId: transactions.id,
      beforeJson: sql`json_object('id', ${transactions.id}, 'cleared', 'cleared')`,
      afterJson: sql`json_object('id', ${transactions.id}, 'cleared', 'reconciled', 'updated_at', ${p.now})`,
      createdAt: p.now,
    },
    sql`from ${transactions} where ${clearedRows(p.accountId)} and exists ${p.guard}`,
  );
}

/** Flags the account's cleared rows reconciled while `guard` holds. */
export function reconcileFlagsStmt(
  db: Db,
  p: { accountId: string; now: string; guard: SQLWrapper },
) {
  return db
    .update(transactions)
    .set({ cleared: "reconciled", updatedAt: p.now })
    .where(sql`${clearedRows(p.accountId)} and exists ${p.guard}`);
}

/** The marker guard: holds once the account's `last_reconciled_at` is `now`. */
export function reconciledAtIs(db: Db, accountId: string, now: string, extra?: SQL) {
  return db
    .select({ x: sql`1` })
    .from(accounts)
    .where(
      extra
        ? sql`${accounts.id} = ${accountId} and ${accounts.lastReconciledAt} = ${now} and ${extra}`
        : sql`${accounts.id} = ${accountId} and ${accounts.lastReconciledAt} = ${now}`,
    );
}

/** A condition: the transaction `id` exists (the adjustment row of this request was written). */
export function transactionIs(id: string): SQL {
  return sql`exists (select 1 from ${transactions} where ${transactions.id} = ${id})`;
}
