import { isLoanType } from "@budget/core/account-types";
import type { Account } from "@budget/schema/accounts";
import { NOT_A_LOAN_TEXT } from "@budget/schema/loan-activity";
import { type LoanPairingRequest, UNPAIRABLE_CATEGORY_TEXT } from "@budget/schema/loan-summary";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as groupsRepo from "../repositories/category-groups";
import * as pairing from "../repositories/loan-pairing";
import { accountFacts, accountToApi } from "./accounts";
import { TransactionRefused } from "./transactions";

const MAX_ATTEMPTS = 3;
export const PAIR_CLOSED_TEXT = "A closed loan cannot be paired with a category";
const refuse = (code: string, detail: string) => new TransactionRefused(422, code, detail);

/**
 * Pairs a loan with an existing category (EXF-482's checks): one guarded account update and its `account`
 * change_log row (before/after paired_category_id) in one batch. D1 calls: the plan, the account, the category,
 * its group, the facts reads, one batch.
 */
export async function pairLoanCategory(
  env: Env,
  actor: string,
  budgetId: string,
  loanId: string,
  input: LoanPairingRequest,
): Promise<Account> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await accountsRepo.findActive(db, budgetId, loanId);
    if (!before) throw new NotFound("Account");
    if (!isLoanType(before.type)) {
      throw refuse("not_a_loan_account", NOT_A_LOAN_TEXT(before.name));
    }
    if (before.closed) throw refuse("account_closed", PAIR_CLOSED_TEXT);
    const cat = await categoriesRepo.findActive(db, budgetId, input.category_id);
    const group = cat ? await groupsRepo.findActive(db, budgetId, cat.groupId) : undefined;
    if (!cat || !group || cat.hidden || cat.kind !== null || group.hidden || group.kind !== null) {
      throw refuse("unprocessable_entity", UNPAIRABLE_CATEGORY_TEXT);
    }
    const facts = (await accountFacts(db, budgetId, loanId))(before);
    const old = before.pairedCategoryId;
    const after = { ...before, pairedCategoryId: cat.id };
    const results = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "account",
          entityId: loanId,
          before: accountToApi(before, facts),
          after: accountToApi(after, facts),
        },
        pairing.pairingHolds(db, budgetId, loanId, old, cat.id),
      ),
      pairing.setPairingStmt(db, budgetId, loanId, old, cat.id),
    ]);
    if ((results[1]?.meta.changes ?? 0) > 0) return accountToApi(after, facts);
  }
  throw new Conflict("Account");
}
