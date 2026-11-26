import type {
  AccountBalances,
  EnterNowRequest,
  PlanTransaction,
} from "@budget/schema/transactions";
import { EnterNowRequest as EnterNowSchema } from "@budget/schema/transactions";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as pendingRepo from "../repositories/pending-transactions";
import * as txRepo from "../repositories/transactions";
import {
  activeAccount,
  activePlan,
  balancesOf,
  createRow,
  detailOf,
  TransactionRefused,
} from "./transactions";

/** A pending item in the Transaction shape the register shows (EXF-466): no category, uncleared, unapproved. */
export function pendingToApi(row: pendingRepo.PendingRow, accountName: string): PlanTransaction {
  return {
    id: row.id,
    budget_id: row.budgetId,
    account_id: row.accountId,
    account_name: accountName,
    date: row.date,
    payee_id: null,
    payee_name: row.payeeName,
    category_id: null,
    inflow_to_ready_to_assign: false,
    memo: null,
    amount: row.amount,
    cleared: "uncleared",
    approved: false,
    created_at: row.createdAt,
    import_id: null,
    source: "plaid",
    imported_payee: row.importedPayee,
    import_payee_name: row.importPayeeName,
    bank_description: row.bankDescription,
    matched: false,
    flag_color: null,
    status: "pending",
    pending_transaction_id: row.plaidTransactionId,
    category_name: null,
    category_group_name: null,
    payee_system: null,
    transfer_account_id: null,
    transfer_transaction_id: null,
    transfer_account_name: null,
    subtransactions: [],
    updated_at: row.updatedAt,
    match_details: null,
  };
}

/** The pending items of an account (or of every open linked account of the plan), and the balances they leave as they are. */
export async function listPendingTransactions(
  env: Env,
  budgetId: string,
  accountId?: string,
): Promise<{ transactions: PlanTransaction[]; balances: AccountBalances }> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  if (accountId) await activeAccount(db, budgetId, accountId);
  const [rows, balances] = await Promise.all([
    pendingRepo.pendingForAccountQuery(db, budgetId, accountId ?? null),
    accountId
      ? balancesOf(db, budgetId, accountId)
      : txRepo.openAccountsBalances(db, budgetId).then((o) => ({
          cleared: o.cleared,
          uncleared: o.uncleared,
          working: o.cleared + o.uncleared,
        })),
  ]);
  return {
    transactions: rows.map((r) => pendingToApi(r.p, r.accountName)),
    balances,
  };
}

/**
 * Enter Now: a real transaction from the pending item (the item's values, overlaid with the body), and the item
 * soft-deleted, in one batch with their change_log rows. A sync that replaced or removed the item meanwhile
 * fails the batch (`pending_changed`, 409).
 */
export async function enterPendingTransaction(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
  body: EnterNowRequest,
) {
  const v = EnterNowSchema.parse(body);
  const db = getDb(env);
  await activePlan(db, budgetId);
  const pend = await pendingRepo.findLive(db, budgetId, id);
  if (!pend) throw new NotFound("Pending transaction");
  const namesIt = v.payee_id !== undefined || v.payee_name !== undefined || !!v.transfer_account_id;
  const named =
    v.category_id !== undefined ||
    v.inflow_to_ready_to_assign !== undefined ||
    (v.subtransactions?.length ?? 0) > 0 ||
    !!v.transfer_account_id;
  try {
    const created = await createRow(
      env,
      actor,
      budgetId,
      {
        account_id: pend.accountId,
        date: v.date ?? pend.date,
        amount: v.amount ?? pend.amount,
        payee_id: v.payee_id,
        payee_name: namesIt ? v.payee_name : pend.payeeName,
        category_id: v.category_id,
        inflow_to_ready_to_assign: v.inflow_to_ready_to_assign,
        memo: v.memo,
        cleared: v.cleared,
        approved: true,
        transfer_account_id: v.transfer_account_id,
        subtransactions: v.subtransactions,
      },
      {
        categoryFor: !named,
        row: {
          approved: true,
          status: "entered",
          pendingTransactionId: pend.plaidTransactionId,
          importedPayee: pend.importedPayee,
          importPayeeName: pend.importPayeeName,
          bankDescription: pend.bankDescription,
          flagColor: v.flag_color ?? null,
        },
        stmts: (row, now) => [
          pendingRepo.pendingLiveCheck(db, pend.id, pend.updatedAt),
          pendingRepo.softDeleteForEnterStmt(db, pend.id, row.id, now),
          changeLogInsert(db, {
            budgetId,
            actor,
            action: "delete",
            entityType: "pending_transaction",
            entityId: pend.id,
            before: pendingRepo.pendingLogShape(pend),
            after: { entered_transaction_id: row.id },
          }),
        ],
      },
    );
    return created;
  } catch (e) {
    if (pendingRepo.isPendingChanged(e)) {
      throw new TransactionRefused(
        409,
        "pending_changed",
        "The bank changed this pending transaction: reload and try again",
      );
    }
    throw e;
  }
}

export { detailOf };
