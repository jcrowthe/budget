import {
  displayGroup,
  isLoanType,
  isOnBudget,
  STARTING_BALANCE_PAYEE,
  startingBalanceAmount,
  startingBalanceFeedsReadyToAssign,
} from "@budget/core/account-types";
import {
  type Account,
  AccountCreate,
  AccountCreateRequest,
  type AccountCreateRequest as AccountCreateRequestInput,
  AccountUpdateRequest,
  type AccountUpdateRequest as AccountUpdateRequestInput,
} from "@budget/schema/accounts";
import type { AccountBalances, Transaction } from "@budget/schema/transactions";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as txRepo from "../repositories/transactions";
import { transactionToApi } from "./transactions";

const MAX_ATTEMPTS = 5;

export class NameTaken extends Error {
  constructor() {
    super("This account name already exists.");
  }
}

export class UnsupportedAccountType extends Error {
  constructor() {
    super(
      "Loan accounts (mortgage, autoLoan, studentLoan, personalLoan, medicalDebt, otherDebt) are not supported yet",
    );
  }
}

export function accountToApi(
  row: accountsRepo.AccountRow,
  b: { cleared: number; uncleared: number } = { cleared: 0, uncleared: 0 },
): Account {
  return {
    id: row.id,
    budget_id: row.budgetId,
    name: row.name,
    type: row.type,
    on_budget: row.onBudget,
    note: row.note,
    starred: row.starred,
    closed: row.closed,
    group: displayGroup(row.type, row.closed),
    sort: row.sortOrder,
    created_at: row.createdAt,
    cleared_balance: b.cleared,
    uncleared_balance: b.uncleared,
    balance: b.cleared + b.uncleared,
  };
}

/** Minimal create; EXF-481 extends it. */
export async function createAccount(
  env: Env,
  actor: string,
  input: AccountCreate,
): Promise<Account> {
  const v = AccountCreate.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, v.budget_id))) throw new NotFound("Plan");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row: accountsRepo.AccountRow = {
      id: crypto.randomUUID(),
      budgetId: v.budget_id,
      name: v.name,
      type: v.type,
      onBudget: v.on_budget ?? isOnBudget(v.type),
      note: v.note ?? null,
      starred: false,
      closed: false,
      sortOrder: (await accountsRepo.maxSort(db, v.budget_id)) + 1,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    // Log first, both guarded on "this sort_order is still the next free one": a lost race writes neither.
    const [, result] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId: row.budgetId,
          actor,
          action: "create",
          entityType: "account",
          entityId: row.id,
          before: null,
          after: accountToApi(row),
        },
        accountsRepo.sortIsNext(db, row.budgetId, row.sortOrder),
      ),
      accountsRepo.insertIfSortStmt(db, row),
    ]);
    if (result.meta.changes > 0) return accountToApi(row);
  }
  throw new Conflict("Account order");
}

export async function listAccounts(
  env: Env,
  budgetId: string,
  opts: { includeClosed?: boolean } = {},
): Promise<Account[]> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const [rows, balances] = await Promise.all([
    accountsRepo.list(db, budgetId, { includeClosed: opts.includeClosed ?? true }),
    txRepo.balancesByAccount(db, budgetId),
  ]);
  return rows.map((r) => accountToApi(r, balances.get(r.id)));
}

export async function getAccount(env: Env, budgetId: string, accountId: string): Promise<Account> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const row = await accountsRepo.findActive(db, budgetId, accountId);
  if (!row) throw new NotFound("Account");
  const balances = await txRepo.balancesByAccount(db, budgetId, accountId);
  return accountToApi(row, balances.get(accountId));
}

/** A rule of the account routes failed; the route answers 422 with this message. */
export class AccountRefused extends Error {
  status = 422 as const;
  code = "unprocessable_entity";
}

/** Sets `starred`. A closed account cannot be starred. One history row per real change. */
export async function updateAccount(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
  input: AccountUpdateRequestInput,
): Promise<Account> {
  const patch = AccountUpdateRequest.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await accountsRepo.findActive(db, budgetId, accountId);
    if (!before) throw new NotFound("Account");
    if (patch.starred === true && before.closed) {
      throw new AccountRefused("A closed account cannot be starred");
    }
    const balances = (await txRepo.balancesByAccount(db, budgetId, accountId)).get(accountId);
    if (patch.starred === undefined || patch.starred === before.starred) {
      return accountToApi(before, balances);
    }
    const after = { ...before, starred: patch.starred };
    const [, result] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "account",
          entityId: accountId,
          before: accountToApi(before, balances),
          after: accountToApi(after, balances),
        },
        accountsRepo.starHolds(db, before),
      ),
      accountsRepo.setStarredIfStmt(db, before, patch.starred),
    ]);
    if (result.meta.changes > 0) return accountToApi(after, balances);
  }
  throw new Conflict("Account");
}

/** The three totals over every open account: the one function behind the summary and All Accounts. */
export async function getAccountSummary(env: Env, budgetId: string): Promise<AccountBalances> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const b = await txRepo.openAccountsBalances(db, budgetId);
  return { ...b, working: b.cleared + b.uncleared };
}

/**
 * Creates an unlinked account and its Starting Balance transaction in one batch. The guards make the name
 * check and the sort order hold inside the write, so two simultaneous creates with one name leave one account.
 */
export async function addUnlinkedAccount(
  env: Env,
  actor: string,
  budgetId: string,
  input: AccountCreateRequestInput,
  opts: { today?: string } = {},
): Promise<{ account: Account; starting_balance: Transaction }> {
  const v = AccountCreateRequest.parse(input);
  if (isLoanType(v.type)) throw new UnsupportedAccountType();
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  if (await accountsRepo.nameTaken(db, budgetId, v.name)) throw new NameTaken();
  const amount = startingBalanceAmount(v.type, v.balance);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const now = new Date().toISOString();
    const row: accountsRepo.AccountRow = {
      id: crypto.randomUUID(),
      budgetId,
      name: v.name,
      type: v.type,
      onBudget: isOnBudget(v.type),
      note: null,
      starred: false,
      closed: false,
      sortOrder: (await accountsRepo.maxSort(db, budgetId)) + 1,
      createdAt: now,
      deletedAt: null,
    };
    const tx: txRepo.TransactionRow = {
      id: crypto.randomUUID(),
      budgetId,
      accountId: row.id,
      date: v.date ?? opts.today ?? now.slice(0, 10),
      payeeName: STARTING_BALANCE_PAYEE,
      categoryId: null,
      inflowToReadyToAssign: startingBalanceFeedsReadyToAssign(v.type),
      memo: null,
      amount,
      cleared: "cleared",
      approved: true,
      createdAt: now,
      deletedAt: null,
      updatedAt: now,
    };
    const account = accountToApi(row, { cleared: amount, uncleared: 0 });
    const g1 = accountsRepo.newAccountGuard(db, budgetId, row.sortOrder, row.name);
    const g2 = accountsRepo.existsStmt(db, row.id);
    const [, result] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "create",
          entityType: "account",
          entityId: row.id,
          before: null,
          after: account,
        },
        g1,
      ),
      accountsRepo.insertIfStmt(db, row, g1),
      txRepo.insertIfStmt(db, tx, g2),
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "create",
          entityType: "transaction",
          entityId: tx.id,
          before: null,
          after: transactionToApi(tx),
        },
        g2,
      ),
    ]);
    if (result.meta.changes > 0) return { account, starting_balance: transactionToApi(tx) };
    if (await accountsRepo.nameTaken(db, budgetId, v.name)) throw new NameTaken();
  }
  throw new Conflict("Account order");
}
