import type { Account } from "@budget/schema/accounts";
import type { TransactionDetail, TransactionUpdateRequest } from "@budget/schema/transactions";

/** True when this saved patch moved a linked account's Starting Balance date (one plan sync follows). */
export function startMoved(
  tx: Pick<TransactionDetail, "payee_system" | "date" | "account_id">,
  body: Pick<TransactionUpdateRequest, "date" | "account_id">,
  account: Pick<Account, "linked"> | undefined,
): boolean {
  return (
    tx.payee_system === "starting_balance" &&
    body.date !== undefined &&
    body.date !== tx.date &&
    (body.account_id === undefined || body.account_id === tx.account_id) &&
    account?.linked === true
  );
}
