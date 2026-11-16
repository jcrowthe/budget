import { CREDIT_ACCOUNT_TYPES, STARTING_BALANCE_PAYEE } from "@budget/core/account-types";
import {
  type PlanSortColumn,
  type RegisterSortColumn,
  type SortDir,
  sortTransactions,
} from "@budget/schema/register";
import {
  type AccountBalances,
  PlainClearedStatus,
  type PlanTransaction,
  type Transaction,
  TransactionCreate,
  TransactionCreateRequest,
  type TransactionDetail,
  TransactionUpdateRequest,
} from "@budget/schema/transactions";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert, changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as txRepo from "../repositories/transactions";

export function transactionToApi(row: txRepo.TransactionRow): Transaction {
  return {
    id: row.id,
    budget_id: row.budgetId,
    account_id: row.accountId,
    date: row.date,
    payee_name: row.payeeName,
    category_id: row.categoryId,
    inflow_to_ready_to_assign: row.inflowToReadyToAssign,
    memo: row.memo,
    amount: row.amount,
    cleared: row.cleared,
    approved: row.approved,
    created_at: row.createdAt,
  };
}

/** Minimal create; the register tickets extend it. */
export async function createTransaction(
  env: Env,
  actor: string,
  input: TransactionCreate,
): Promise<Transaction> {
  const v = TransactionCreate.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, v.budget_id))) throw new NotFound("Plan");
  if (!(await accountsRepo.findActive(db, v.budget_id, v.account_id)))
    throw new NotFound("Account");
  if (v.category_id && !(await categoriesRepo.findActive(db, v.budget_id, v.category_id))) {
    throw new NotFound("Category");
  }
  const now = new Date().toISOString();
  const row: txRepo.TransactionRow = {
    id: crypto.randomUUID(),
    budgetId: v.budget_id,
    accountId: v.account_id,
    date: v.date,
    payeeName: v.payee_name ?? null,
    categoryId: v.category_id ?? null,
    inflowToReadyToAssign: v.inflow_to_ready_to_assign,
    memo: v.memo ?? null,
    amount: v.amount,
    cleared: v.cleared,
    approved: v.approved,
    createdAt: now,
    deletedAt: null,
    updatedAt: now,
  };
  await db.batch([
    txRepo.insertStmt(db, row),
    changeLogInsert(db, {
      budgetId: row.budgetId,
      actor,
      action: "create",
      entityType: "transaction",
      entityId: row.id,
      before: null,
      after: transactionToApi(row),
    }),
  ]);
  return transactionToApi(row);
}

const MAX_ATTEMPTS = 5;

/** A rule of the register routes failed; the route answers `status` with `code` and this message. */
export class TransactionRefused extends Error {
  constructor(
    public status: 409 | 422,
    public code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "TransactionRefused";
  }
}

const unprocessable = (detail: string) =>
  new TransactionRefused(422, "unprocessable_entity", detail);

export function transactionDetailToApi(row: txRepo.TransactionDetailRow): TransactionDetail {
  return {
    ...transactionToApi(row),
    category_name: row.categoryName,
    category_group_name: row.groupName,
    updated_at: row.updatedAt,
  };
}

/** The change_log copy of a row: the API shape without `updated_at`. */
function logShape(row: txRepo.TransactionDetailRow) {
  return {
    ...transactionToApi(row),
    category_name: row.categoryName,
    category_group_name: row.groupName,
  };
}

type Db = ReturnType<typeof getDb>;

async function activePlan(db: Db, budgetId: string) {
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
}

async function activeAccount(db: Db, budgetId: string, accountId: string) {
  const a = await accountsRepo.findActive(db, budgetId, accountId);
  if (!a) throw new NotFound("Account");
  return a;
}

async function detailOf(db: Db, budgetId: string, id: string): Promise<TransactionDetail> {
  const row = await txRepo.findDetail(db, budgetId, id);
  if (!row) throw new NotFound("Transaction");
  return transactionDetailToApi(row);
}

async function balancesOf(db: Db, budgetId: string, accountId: string): Promise<AccountBalances> {
  const b = (await txRepo.balancesByAccount(db, budgetId, accountId)).get(accountId) ?? {
    cleared: 0,
    uncleared: 0,
  };
  return { ...b, working: b.cleared + b.uncleared };
}

export async function getAccountBalances(
  env: Env,
  budgetId: string,
  accountId: string,
): Promise<AccountBalances> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  await activeAccount(db, budgetId, accountId);
  return balancesOf(db, budgetId, accountId);
}

export async function listAccountTransactions(
  env: Env,
  budgetId: string,
  accountId: string,
  opts: { sinceDate?: string; sort?: RegisterSortColumn; dir?: SortDir } = {},
): Promise<{ transactions: TransactionDetail[]; balances: AccountBalances }> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  await activeAccount(db, budgetId, accountId);
  const [rows, balances] = await Promise.all([
    txRepo.listDetailForAccount(db, budgetId, accountId, opts.sinceDate),
    balancesOf(db, budgetId, accountId),
  ]);
  const detail = rows.map(transactionDetailToApi);
  return {
    transactions: sortTransactions(detail, opts.sort ?? "date", opts.dir ?? "desc"),
    balances,
  };
}

export async function listPlanTransactions(
  env: Env,
  budgetId: string,
  opts: { sinceDate?: string; sort?: PlanSortColumn; dir?: SortDir } = {},
): Promise<{ transactions: PlanTransaction[]; balances: AccountBalances }> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  const [rows, open] = await Promise.all([
    txRepo.listDetailForPlan(db, budgetId, opts.sinceDate),
    txRepo.openAccountsBalances(db, budgetId),
  ]);
  const detail = rows.map((r) => ({ ...transactionDetailToApi(r), account_name: r.accountName }));
  return {
    transactions: sortTransactions(detail, opts.sort ?? "date", opts.dir ?? "desc"),
    balances: { ...open, working: open.cleared + open.uncleared },
  };
}

export async function getTransaction(
  env: Env,
  budgetId: string,
  id: string,
): Promise<TransactionDetail> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  return detailOf(db, budgetId, id);
}

const isCreditStartingBalance = (
  account: { type: string },
  row: Pick<txRepo.TransactionRow, "payeeName" | "categoryId" | "inflowToReadyToAssign">,
) =>
  (CREDIT_ACCOUNT_TYPES as readonly string[]).includes(account.type) &&
  row.payeeName === STARTING_BALANCE_PAYEE &&
  row.categoryId === null &&
  !row.inflowToReadyToAssign;

function parseCleared(v: string | undefined): "uncleared" | "cleared" | undefined {
  if (v === undefined) return undefined;
  if (v === "reconciled") throw unprocessable("Reconciling is not available here");
  const r = PlainClearedStatus.safeParse(v);
  if (!r.success) throw unprocessable("cleared must be uncleared or cleared");
  return r.data;
}

const clean = (v: string | null | undefined) => {
  if (v === undefined) return undefined;
  const t = v?.trim() ?? "";
  return t === "" ? null : t;
};

/** Rules on the merged row; `before` is the row being changed (undefined for a create). */
async function validate(
  db: Db,
  budgetId: string,
  merged: txRepo.TransactionRow,
  account: accountsRepo.AccountRow,
  before?: txRepo.TransactionRow,
  beforeAccount?: accountsRepo.AccountRow,
) {
  if (merged.categoryId && merged.inflowToReadyToAssign) {
    throw unprocessable(
      "A transaction cannot have both a category and the Ready to Assign inflow flag",
    );
  }
  if (!account.onBudget && (merged.categoryId || merged.inflowToReadyToAssign)) {
    throw unprocessable("Tracking accounts do not take a category");
  }
  if (merged.categoryId && !(await categoriesRepo.findActive(db, budgetId, merged.categoryId))) {
    throw unprocessable("Category not found in this plan");
  }
  const ownStarting =
    before &&
    beforeAccount &&
    isCreditStartingBalance(beforeAccount, before) &&
    before.accountId === account.id;
  if (
    (CREDIT_ACCOUNT_TYPES as readonly string[]).includes(account.type) &&
    merged.payeeName === STARTING_BALANCE_PAYEE &&
    !ownStarting
  ) {
    throw unprocessable("This payee name is reserved");
  }
}

export async function addTransaction(
  env: Env,
  actor: string,
  budgetId: string,
  input: TransactionCreateRequest,
): Promise<TransactionDetail> {
  const v = TransactionCreateRequest.parse(input);
  const db = getDb(env);
  await activePlan(db, budgetId);
  const account = await activeAccount(db, budgetId, v.account_id);
  const cleared = parseCleared(v.cleared) ?? "uncleared";
  const now = new Date().toISOString();
  const row: txRepo.TransactionRow = {
    id: crypto.randomUUID(),
    budgetId,
    accountId: account.id,
    date: v.date,
    payeeName: clean(v.payee_name) ?? null,
    categoryId: v.category_id ?? null,
    inflowToReadyToAssign: v.inflow_to_ready_to_assign ?? false,
    memo: clean(v.memo) ?? null,
    amount: v.amount,
    cleared,
    approved: v.approved ?? true,
    createdAt: now,
    deletedAt: null,
    updatedAt: now,
  };
  await validate(db, budgetId, row, account);
  const cat = row.categoryId ? await categoriesRepo.findActive(db, budgetId, row.categoryId) : null;
  const group = cat ? await txRepo.groupNameOfCategory(db, cat.id) : null;
  await db.batch([
    txRepo.insertStmt(db, row),
    changeLogInsert(db, {
      budgetId,
      actor,
      action: "create",
      entityType: "transaction",
      entityId: row.id,
      before: null,
      after: logShape({ ...row, categoryName: cat?.name ?? null, groupName: group }),
    }),
  ]);
  return detailOf(db, budgetId, row.id);
}

type Prepared = { before: txRepo.TransactionDetailRow; after: txRepo.TransactionRow };

async function mutate(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
  kind: "update" | "delete",
  patch: TransactionUpdateRequest | undefined,
): Promise<TransactionDetail> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await txRepo.findDetail(db, budgetId, id);
    if (!before) throw new NotFound("Transaction");
    if (before.cleared === "reconciled") {
      throw new TransactionRefused(409, "transaction_reconciled", "This transaction is reconciled");
    }
    const beforeAccount = await activeAccount(db, budgetId, before.accountId);
    const prepared = await prepare(db, budgetId, before, beforeAccount, kind, patch);
    const log = {
      budgetId,
      actor,
      action: kind,
      entityType: "transaction",
      entityId: id,
      before: logShape(before),
      after: kind === "delete" ? null : prepared.afterLog,
    } as const;
    const now = new Date().toISOString();
    const stmt =
      kind === "delete"
        ? txRepo.softDeleteIfHoldsStmt(db, before, now)
        : txRepo.updateIfHoldsStmt(db, before, prepared.after, now);
    const [, w] = await db.batch([changeLogInsertIf(db, log, txRepo.holds(db, before)), stmt]);
    if ((w.meta.changes ?? 0) > 0) {
      if (kind === "delete") {
        return transactionDetailToApi({ ...before, updatedAt: now });
      }
      return detailOf(db, budgetId, id);
    }
  }
  throw new Conflict("Transaction");
}

async function prepare(
  db: Db,
  budgetId: string,
  before: txRepo.TransactionDetailRow,
  beforeAccount: accountsRepo.AccountRow,
  kind: "update" | "delete",
  patch: TransactionUpdateRequest | undefined,
): Promise<Prepared & { afterLog: unknown }> {
  if (kind === "delete" || !patch) return { before, after: before, afterLog: null };
  const p = patch;
  const cleared = parseCleared(p.cleared);
  const account = p.account_id ? await activeAccount(db, budgetId, p.account_id) : beforeAccount;
  const after: txRepo.TransactionRow = {
    ...before,
    accountId: account.id,
    date: p.date ?? before.date,
    payeeName: p.payee_name === undefined ? before.payeeName : (clean(p.payee_name) ?? null),
    categoryId: p.category_id === undefined ? before.categoryId : p.category_id,
    inflowToReadyToAssign: p.inflow_to_ready_to_assign ?? before.inflowToReadyToAssign,
    memo: p.memo === undefined ? before.memo : (clean(p.memo) ?? null),
    amount: p.amount ?? before.amount,
    cleared: cleared ?? before.cleared,
    approved: p.approved ?? before.approved,
  };
  if (
    isCreditStartingBalance(beforeAccount, before) &&
    (after.payeeName !== before.payeeName ||
      after.categoryId !== before.categoryId ||
      after.inflowToReadyToAssign !== before.inflowToReadyToAssign ||
      after.accountId !== before.accountId)
  ) {
    throw new TransactionRefused(
      409,
      "starting_balance_locked",
      "A credit account's Starting Balance keeps its payee, category and account",
    );
  }
  await validate(db, budgetId, after, account, before, beforeAccount);
  let names = { categoryName: before.categoryName, groupName: before.groupName };
  if (after.categoryId !== before.categoryId) {
    const cat = after.categoryId
      ? await categoriesRepo.findActive(db, budgetId, after.categoryId)
      : null;
    names = {
      categoryName: cat?.name ?? null,
      groupName: cat ? await txRepo.groupNameOfCategory(db, cat.id) : null,
    };
  }
  return { before, after, afterLog: logShape({ ...after, ...names }) };
}

export async function updateTransaction(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
  patch: TransactionUpdateRequest,
): Promise<TransactionDetail> {
  return mutate(env, actor, budgetId, id, "update", TransactionUpdateRequest.parse(patch));
}

export async function deleteTransaction(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
): Promise<TransactionDetail> {
  return mutate(env, actor, budgetId, id, "delete", undefined);
}
