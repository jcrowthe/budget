import { CREDIT_ACCOUNT_TYPES } from "@budget/core/account-types";
import { OWN_PAYMENT_TEXT } from "@budget/schema/card-payments";
import { DEFAULT_FORMATTER, type PlanFormatter, planFormatter } from "@budget/schema/plan-formats";
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
  type SubTransaction,
  type Transaction,
  TransactionCreate,
  TransactionCreateRequest,
  type TransactionDetail,
  TransactionUpdateRequest,
} from "@budget/schema/transactions";
import { transferCategoryRule, transferPayeeName } from "@budget/schema/transfers";
import type { SQLWrapper } from "drizzle-orm";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { type ChangeLogEntry, changeLogInsert, changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as importsRepo from "../repositories/imports";
import * as payeesRepo from "../repositories/payees";
import * as txRepo from "../repositories/transactions";
import { importStartAfterMove, importStartStmts } from "./account-links";
import { runGroups, type StatementGroup } from "./batch-groups";
import { formatsOfRow } from "./budgets";
import { resolvePayee } from "./payees";
import { mirror, newOtherSide, sameSide } from "./transaction-pairs";
import { validateLines } from "./transaction-splits";
import { bulkTransactions } from "./transactions-bulk";

export function transactionToApi(row: txRepo.TransactionRow): Transaction {
  return {
    id: row.id,
    budget_id: row.budgetId,
    account_id: row.accountId,
    date: row.date,
    payee_id: row.payeeId,
    payee_name: row.payeeName,
    category_id: row.categoryId,
    inflow_to_ready_to_assign: row.inflowToReadyToAssign,
    memo: row.memo,
    amount: row.amount,
    cleared: row.cleared,
    approved: row.approved,
    created_at: row.createdAt,
    import_id: row.importId ?? null,
    source: row.source ?? null,
    imported_payee: row.importedPayee ?? null,
    bank_description: row.bankDescription ?? null,
    matched: (row.importId ?? null) !== null && (row.source ?? null) === null,
    flag_color: row.flagColor ?? null,
  };
}

type Stmts = Parameters<ReturnType<typeof getDb>["batch"]>[0];
/** A batch list that may start with optional payee statements; it always holds the row's own. */
const stmts = (list: unknown[]) => list as unknown as Stmts;

/** The payee's insert and its change_log row, for a batch that creates it with a transaction. */
export function payeeInsert(db: Db, actor: string, p: payeesRepo.PayeeRow) {
  return [
    payeesRepo.insertStmt(db, p),
    changeLogInsert(db, {
      budgetId: p.budgetId,
      actor,
      action: "create",
      entityType: "payee",
      entityId: p.id,
      before: null,
      after: payeeLog(p),
    }),
  ] as const;
}

const payeeLog = (p: payeesRepo.PayeeRow) => ({
  id: p.id,
  name: p.name,
  hidden: p.hidden,
  system: p.system,
});

/** Minimal create (an internal helper for tests): no register rules, but payees keep the race retry. */
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
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const payee = await resolvePayee(db, v.budget_id, { payee_name: v.payee_name ?? null });
    const now = new Date().toISOString();
    const row: txRepo.TransactionRow = {
      id: crypto.randomUUID(),
      budgetId: v.budget_id,
      accountId: v.account_id,
      date: v.date,
      payeeId: payee?.payeeId ?? null,
      payeeName: payee?.name ?? null,
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
    try {
      await db.batch(
        stmts([
          ...(payee?.create ? payeeInsert(db, actor, payee.create) : []),
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
        ]),
      );
    } catch (e) {
      if (payee?.create && payeesRepo.isUniqueViolation(e)) continue;
      throw e;
    }
    return transactionToApi(row);
  }
  throw new Conflict("Payee");
}

export const MAX_ATTEMPTS = 5;

/** A plain transaction from a schedule: its insert and its create log row, both written only while `guard` holds. */
export function enteredTransactionWrites(
  db: Db,
  actor: string,
  row: txRepo.TransactionRow,
  names: { categoryName: string | null; groupName: string | null },
  guard: SQLWrapper,
): unknown[] {
  return [
    txRepo.insertIfStmt(db, row, guard),
    changeLogInsertIf(
      db,
      {
        budgetId: row.budgetId,
        actor,
        action: "create",
        entityType: "transaction",
        entityId: row.id,
        before: null,
        after: logShape({ ...row, ...names }),
      },
      guard,
    ),
  ];
}

/** A rule of the register routes failed; the route answers `status` with `code` and this message. */
export class TransactionRefused extends Error {
  constructor(
    public status: 404 | 409 | 422,
    public code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "TransactionRefused";
  }
}

const unprocessable = (detail: string) =>
  new TransactionRefused(422, "unprocessable_entity", detail);
const closedAccount = (detail: string) => new TransactionRefused(422, "account_closed", detail);
export const CLOSED_NO_NEW = "This account is closed: it takes no new transactions";
export const CLOSED_NO_MOVE = "A transaction cannot be moved into a closed account";
export const CLOSED_OTHER = "The other account of a transfer is closed: it must be open";

export function lineToApi(l: txRepo.LineRow): SubTransaction {
  return {
    id: l.id,
    amount: l.amount,
    payee_id: l.payeeId,
    payee_name: l.payeeName,
    category_id: l.categoryId,
    category_name: l.categoryName,
    category_group_name: l.groupName,
    inflow_to_ready_to_assign: l.inflowToReadyToAssign,
    memo: l.memo,
  };
}

export function transactionDetailToApi(
  row: txRepo.TransactionDetailRow,
  lines: readonly txRepo.LineRow[] = [],
): TransactionDetail {
  const matched = (row.importId ?? null) !== null && (row.source ?? null) === null;
  return {
    ...transactionToApi(row),
    category_name: row.categoryName,
    category_group_name: row.groupName,
    payee_system: row.payeeSystem,
    transfer_account_id: row.transferAccountId ?? null,
    transfer_transaction_id: row.transferTransactionId ?? null,
    transfer_account_name: row.transferAccountName,
    subtransactions: lines.map(lineToApi),
    updated_at: row.updatedAt,
    match_details:
      matched && row.importDate != null && row.importAmount != null
        ? {
            date: row.importDate,
            amount: row.importAmount,
            payee_name: row.importPayeeName ?? null,
          }
        : null,
  };
}

export type LogRow = txRepo.TransactionRow & {
  categoryName: string | null;
  groupName: string | null;
};

/** The change_log copy of a row: the API shape without `updated_at`, with its lines. */
export function logShape(row: LogRow, lines: readonly txRepo.LineRow[] = []) {
  return {
    ...transactionToApi(row),
    category_name: row.categoryName,
    category_group_name: row.groupName,
    transfer_account_id: row.transferAccountId ?? null,
    transfer_transaction_id: row.transferTransactionId ?? null,
    subtransactions: lines.map(lineToApi),
  };
}

export async function namesOf(db: Db, budgetId: string, categoryId: string | null | undefined) {
  if (!categoryId) return { categoryName: null, groupName: null };
  const cat = await categoriesRepo.findActive(db, budgetId, categoryId);
  return {
    categoryName: cat?.name ?? null,
    groupName: cat ? await txRepo.groupNameOfCategory(db, cat.id) : null,
  };
}

/** A line row with its category names, for the log and the response. */
async function withLineNames(
  db: Db,
  budgetId: string,
  rows: readonly txRepo.TransactionRow[],
): Promise<txRepo.LineRow[]> {
  return Promise.all(
    rows.map(async (r) => ({ ...r, ...(await namesOf(db, budgetId, r.categoryId)) })),
  );
}

type Db = ReturnType<typeof getDb>;

export async function activePlan(db: Db, budgetId: string) {
  const row = await budgetsRepo.findActive(db, budgetId);
  if (!row) throw new NotFound("Plan");
  return row;
}

export async function activeAccount(db: Db, budgetId: string, accountId: string) {
  const a = await accountsRepo.findActive(db, budgetId, accountId);
  if (!a) throw new NotFound("Account");
  return a;
}

export async function detailOf(db: Db, budgetId: string, id: string): Promise<TransactionDetail> {
  const row = await txRepo.findDetail(db, budgetId, id);
  if (!row) throw new NotFound("Transaction");
  return transactionDetailToApi(row, await txRepo.listLines(db, budgetId, { parentId: id }));
}

export function linesByParent(lines: readonly txRepo.LineRow[]) {
  const map = new Map<string, txRepo.LineRow[]>();
  for (const l of lines) {
    const key = l.parentTransactionId as string;
    map.set(key, [...(map.get(key) ?? []), l]);
  }
  return map;
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
  opts: {
    sinceDate?: string;
    sort?: RegisterSortColumn;
    dir?: SortDir;
    needs?: "approval_or_category";
    include?: "running_balance";
  } = {},
): Promise<{
  transactions: (TransactionDetail & { running_balance?: number })[];
  balances: AccountBalances;
}> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  await activeAccount(db, budgetId, accountId);
  const [rows, balances, lines] = await Promise.all([
    txRepo.listDetailForAccount(db, budgetId, accountId, opts.sinceDate, opts.needs, {
      runningBalance: opts.include === "running_balance",
    }),
    balancesOf(db, budgetId, accountId),
    txRepo.listLines(db, budgetId, { accountId, sinceDate: opts.sinceDate }),
  ]);
  const byParent = linesByParent(lines);
  const detail = rows.map((r) => ({
    ...transactionDetailToApi(r, byParent.get(r.id)),
    ...(r.runningBalance === undefined ? {} : { running_balance: r.runningBalance }),
  }));
  return {
    transactions: sortTransactions(detail, opts.sort ?? "date", opts.dir ?? "desc"),
    balances,
  };
}

export async function listPlanTransactions(
  env: Env,
  budgetId: string,
  opts: {
    sinceDate?: string;
    sort?: PlanSortColumn;
    dir?: SortDir;
    needs?: "approval_or_category";
  } = {},
): Promise<{ transactions: PlanTransaction[]; balances: AccountBalances }> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  const [rows, open, lines] = await Promise.all([
    txRepo.listDetailForPlan(db, budgetId, opts.sinceDate, opts.needs),
    txRepo.openAccountsBalances(db, budgetId),
    txRepo.listLines(db, budgetId, { sinceDate: opts.sinceDate }),
  ]);
  const byParent = linesByParent(lines);
  const detail = rows.map((r) => ({
    ...transactionDetailToApi(r, byParent.get(r.id)),
    account_name: r.accountName,
  }));
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

export const isCreditStartingBalance = (
  account: { type: string },
  row: Pick<txRepo.TransactionDetailRow, "payeeSystem" | "categoryId" | "inflowToReadyToAssign">,
) =>
  (CREDIT_ACCOUNT_TYPES as readonly string[]).includes(account.type) &&
  row.payeeSystem === "starting_balance" &&
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
  known?: ReadonlyMap<string, { kind: string | null; accountId: string | null }>,
) {
  if (merged.categoryId && merged.inflowToReadyToAssign) {
    throw unprocessable(
      "A transaction cannot have both a category and the Ready to Assign inflow flag",
    );
  }
  if (!account.onBudget && (merged.categoryId || merged.inflowToReadyToAssign)) {
    throw unprocessable("Tracking accounts do not take a category");
  }
  if (merged.categoryId) {
    const category = known
      ? known.get(merged.categoryId)
      : await categoriesRepo.findActive(db, budgetId, merged.categoryId);
    if (!category) throw unprocessable("Category not found in this plan");
    refuseOwnPaymentCategory(account, category);
  }
}

/** D5: a row on a card may not use that card's own payment category (payments are transfers). */
export function refuseOwnPaymentCategory(
  account: { id: string; name: string },
  category: { kind: string | null; accountId: string | null } | undefined,
) {
  if (category?.kind === "credit_card_payment" && category.accountId === account.id) {
    throw new TransactionRefused(422, "own_payment_category", OWN_PAYMENT_TEXT(account.name));
  }
}

async function otherAccountOf(
  db: Db,
  budgetId: string,
  accountId: string,
  otherId: string,
  requireOpen = true,
  known?: ReadonlyMap<string, accountsRepo.AccountRow>,
): Promise<accountsRepo.AccountRow> {
  const other = known ? known.get(otherId) : await accountsRepo.findActive(db, budgetId, otherId);
  if (!other) throw unprocessable("Account not found in this plan");
  if (other.id === accountId) throw unprocessable("A transfer needs two different accounts");
  if (requireOpen && other.closed) throw closedAccount(CLOSED_OTHER);
  return other;
}

const NO_TRANSFER_CATEGORY = "A transfer between on-plan accounts takes no category";

/** Applies the category rule to a transfer side: not needed clears it (422 when the request sent one). */
function applyTransferRule(
  row: txRepo.TransactionRow,
  account: accountsRepo.AccountRow,
  other: accountsRepo.AccountRow,
  sent: boolean,
) {
  if (
    transferCategoryRule({ on_budget: account.onBudget }, { on_budget: other.onBudget }) !==
    "not_needed"
  ) {
    return;
  }
  if (sent && (row.categoryId || row.inflowToReadyToAssign)) {
    throw unprocessable(NO_TRANSFER_CATEGORY);
  }
  row.categoryId = null;
  row.inflowToReadyToAssign = false;
}

function refuseOtherReconciled(other: txRepo.TransactionDetailRow) {
  if (other.cleared === "reconciled") {
    throw new TransactionRefused(
      409,
      "transaction_reconciled",
      "The other side of this transfer is reconciled",
    );
  }
}

/** Both rows of a new transfer in one batch, one `create` log row per side. */
async function insertPair(
  db: Db,
  actor: string,
  budgetId: string,
  a: txRepo.TransactionRow,
  b: txRepo.TransactionRow,
) {
  // Drizzle statements are thenable: build them after every await, never return one from an async function.
  const [na, nb] = await Promise.all([
    namesOf(db, budgetId, a.categoryId),
    namesOf(db, budgetId, b.categoryId),
  ]);
  const entry = (r: txRepo.TransactionRow, names: Awaited<ReturnType<typeof namesOf>>) =>
    changeLogInsert(db, {
      budgetId,
      actor,
      action: "create",
      entityType: "transaction",
      entityId: r.id,
      before: null,
      after: logShape({ ...r, ...names }),
    });
  await db.batch(
    stmts([txRepo.insertStmt(db, a), txRepo.insertStmt(db, b), entry(a, na), entry(b, nb)]),
  );
}

export async function addTransaction(
  env: Env,
  actor: string,
  budgetId: string,
  input: TransactionCreateRequest,
): Promise<TransactionDetail> {
  const v = TransactionCreateRequest.parse(input);
  const db = getDb(env);
  const planRow = await activePlan(db, budgetId);
  const account = await activeAccount(db, budgetId, v.account_id);
  if (account.closed) throw closedAccount(CLOSED_NO_NEW);
  const cleared = parseCleared(v.cleared) ?? "uncleared";
  const lineInputs = v.subtransactions && v.subtransactions.length > 0 ? v.subtransactions : null;
  const transferId = v.transfer_account_id ?? null;
  if (lineInputs && transferId) throw unprocessable("A transfer cannot be split");
  const hasPayee = (v.payee_id ?? v.payee_name ?? null) !== null;
  if (transferId && hasPayee) {
    throw unprocessable("A transfer has no payee: its payee is the other account");
  }
  const other = transferId ? await otherAccountOf(db, budgetId, account.id, transferId) : null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const payee = transferId
      ? undefined
      : await resolvePayee(db, budgetId, { payee_id: v.payee_id, payee_name: v.payee_name });
    const now = new Date().toISOString();
    const row: txRepo.TransactionRow = {
      id: crypto.randomUUID(),
      budgetId,
      accountId: account.id,
      date: v.date,
      payeeId: payee?.payeeId ?? null,
      payeeName: other ? transferPayeeName(other.name) : (payee?.name ?? null),
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
    if (other) {
      applyTransferRule(row, account, other, true);
      await validate(db, budgetId, row, account);
      const side = newOtherSide(row, other.id, account.name, now);
      row.transferAccountId = other.id;
      row.transferTransactionId = side.id;
      await insertPair(db, actor, budgetId, row, side);
      return detailOf(db, budgetId, row.id);
    }
    if (lineInputs) {
      if (row.categoryId || row.inflowToReadyToAssign) {
        throw unprocessable("A split transaction's category is in its lines");
      }
      const { rows, payeeCreates } = await validateLines(
        db,
        budgetId,
        row,
        lineInputs,
        account,
        now,
        payee,
        planFormatter(formatsOfRow(planRow)),
      );
      const parentCreates = payee?.create ? [payee.create] : [];
      const lineRows = await withLineNames(db, budgetId, rows);
      try {
        await db.batch(
          stmts([
            ...[...parentCreates, ...payeeCreates].flatMap((pc) => payeeInsert(db, actor, pc)),
            txRepo.insertStmt(db, row),
            ...rows.map((r) => txRepo.insertStmt(db, r)),
            changeLogInsert(db, {
              budgetId,
              actor,
              action: "create",
              entityType: "transaction",
              entityId: row.id,
              before: null,
              after: logShape({ ...row, categoryName: null, groupName: null }, lineRows),
            }),
            ...payeesRepo.livePayeesCheck(db, budgetId, [
              row.payeeId,
              ...rows.map((r) => r.payeeId),
            ]),
          ]),
        );
      } catch (e) {
        if ((payee?.create || payeeCreates.length > 0) && payeesRepo.isUniqueViolation(e)) continue;
        if (payeesRepo.isPayeeGone(e)) continue;
        throw e;
      }
      return detailOf(db, budgetId, row.id);
    }
    await validate(db, budgetId, row, account);
    const names = await namesOf(db, budgetId, row.categoryId);
    try {
      await db.batch(
        stmts([
          ...(payee?.create ? payeeInsert(db, actor, payee.create) : []),
          txRepo.insertStmt(db, row),
          changeLogInsert(db, {
            budgetId,
            actor,
            action: "create",
            entityType: "transaction",
            entityId: row.id,
            before: null,
            after: logShape({ ...row, ...names }),
          }),
          ...payeesRepo.livePayeesCheck(db, budgetId, [payee?.create ? null : payee?.payeeId]),
        ]),
      );
    } catch (e) {
      // Another request created the same payee first, or deleted the one found: the next pass looks again.
      if (payee?.create && payeesRepo.isUniqueViolation(e)) continue;
      if (payeesRepo.isPayeeGone(e)) continue;
      throw e;
    }
    return detailOf(db, budgetId, row.id);
  }
  throw new Conflict("Payee");
}

/** Both sides of a transfer from one call: `from` gets -amount, `to` +amount. */
export async function createTransfer(
  env: Env,
  actor: string,
  budgetId: string,
  input: {
    from_account_id: string;
    to_account_id: string;
    amount: number;
    date: string;
    memo?: string | null;
    category_id?: string | null;
    cleared?: "uncleared" | "cleared";
  },
): Promise<{ from_transaction: TransactionDetail; to_transaction: TransactionDetail }> {
  const v = TransactionCreateRequest.parse({
    account_id: input.from_account_id,
    date: input.date,
    amount: input.amount > 0 ? -input.amount : input.amount,
    memo: input.memo,
    cleared: input.cleared,
  });
  if (!(input.amount > 0)) throw unprocessable("amount is the positive amount moved");
  const db = getDb(env);
  await activePlan(db, budgetId);
  const from = await activeAccount(db, budgetId, input.from_account_id);
  if (from.closed) throw closedAccount(CLOSED_NO_NEW);
  const to = await otherAccountOf(db, budgetId, from.id, input.to_account_id);
  const cleared = parseCleared(v.cleared) ?? "uncleared";
  const now = new Date().toISOString();
  const a: txRepo.TransactionRow = {
    id: crypto.randomUUID(),
    budgetId,
    accountId: from.id,
    date: v.date,
    payeeId: null,
    payeeName: transferPayeeName(to.name),
    categoryId: null,
    inflowToReadyToAssign: false,
    memo: clean(v.memo) ?? null,
    amount: v.amount,
    cleared,
    approved: true,
    createdAt: now,
    deletedAt: null,
    updatedAt: now,
  };
  const b = newOtherSide(a, to.id, from.name, now);
  a.transferAccountId = to.id;
  a.transferTransactionId = b.id;
  if (input.category_id) {
    // Only a transfer between an on-plan and a tracking account takes a category, on the on-plan side.
    if (from.onBudget === to.onBudget) {
      throw unprocessable(
        from.onBudget ? NO_TRANSFER_CATEGORY : "Tracking accounts do not take a category",
      );
    }
    const target = from.onBudget ? a : b;
    target.categoryId = input.category_id;
    await validate(db, budgetId, target, from.onBudget ? from : to);
  }
  await insertPair(db, actor, budgetId, a, b);
  return {
    from_transaction: await detailOf(db, budgetId, a.id),
    to_transaction: await detailOf(db, budgetId, b.id),
  };
}

type OtherOp =
  | { kind: "update"; before: txRepo.TransactionDetailRow; row: txRepo.TransactionRow }
  | { kind: "delete"; before: txRepo.TransactionDetailRow; row: txRepo.TransactionRow }
  | { kind: "insert"; row: txRepo.TransactionRow };

export type Plan = {
  before: txRepo.TransactionDetailRow;
  beforeLines: txRepo.LineRow[];
  after: txRepo.TransactionRow;
  others: OtherOp[];
  lines: { mode: "none" | "sync" | "replace" | "remove"; rows: txRepo.TransactionRow[] };
  payeeCreates: payeesRepo.PayeeRow[];
  logs: Omit<ChangeLogEntry, "budgetId" | "actor">[];
};

const setOf = (r: txRepo.TransactionRow, updatedAt: string): txRepo.TxSet => ({
  accountId: r.accountId,
  date: r.date,
  payeeName: r.payeeName,
  payeeId: r.payeeId,
  categoryId: r.categoryId,
  inflowToReadyToAssign: r.inflowToReadyToAssign,
  memo: r.memo,
  amount: r.amount,
  cleared: r.cleared,
  approved: r.approved,
  transferAccountId: r.transferAccountId ?? null,
  transferTransactionId: r.transferTransactionId ?? null,
  flagColor: r.flagColor ?? null,
  updatedAt,
});

/** The statements of one planned change, grouped by when they may run: payees, logs, then the rest, then the row's own write. */
export function planWrites(
  db: Db,
  w: {
    budgetId: string;
    actor: string;
    id: string;
    kind: "update" | "delete";
    plan: Plan;
    now: string;
    guard: SQLWrapper;
    selfGuard: SQLWrapper;
  },
) {
  const { budgetId, actor, id, kind, plan, now, guard, selfGuard } = w;
  const { before, after } = plan;
  const payees: unknown[] = [];
  const logs: unknown[] = [];
  const rest: unknown[] = [];
  for (const pc of plan.payeeCreates) {
    payees.push(
      payeesRepo.insertIfStmt(db, pc, guard),
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "create",
          entityType: "payee",
          entityId: pc.id,
          before: null,
          after: payeeLog(pc),
        },
        guard,
      ),
    );
  }
  for (const l of plan.logs) {
    logs.push(changeLogInsertIf(db, { budgetId, actor, ...l }, guard));
  }
  if (plan.lines.mode === "sync") {
    rest.push(
      txRepo.syncLinesIfStmt(
        db,
        id,
        {
          accountId: after.accountId,
          date: after.date,
          cleared: after.cleared,
          approved: after.approved,
          updatedAt: now,
        },
        guard,
      ),
    );
  } else if (plan.lines.mode !== "none") {
    rest.push(txRepo.softDeleteLinesIfStmt(db, id, now, guard));
    for (const r of plan.lines.rows) rest.push(txRepo.insertIfStmt(db, r, guard));
  }
  // A row the user deletes that came from the bank is never imported again.
  const deleted = [
    ...(kind === "delete" ? [before] : []),
    ...plan.others.flatMap((o) => (o.kind === "delete" ? [o.row] : [])),
  ];
  for (const d of deleted) {
    if (!d.importId) continue;
    rest.push(
      importsRepo.tombstoneIfStmt(
        db,
        {
          accountId: d.accountId,
          importId: d.importId,
          budgetId,
          reason: "deleted",
          transactionId: d.id,
        },
        guard,
        now,
      ),
    );
  }
  for (const o of plan.others) {
    if (o.kind === "insert") rest.push(txRepo.insertIfStmt(db, o.row, guard));
    else if (o.kind === "delete") rest.push(txRepo.softDeleteIfStmt(db, o.row.id, now, guard));
    else rest.push(txRepo.updateIfStmt(db, o.row.id, setOf(o.row, now), guard));
  }
  const self =
    kind === "delete"
      ? txRepo.softDeleteIfStmt(db, id, now, selfGuard)
      : txRepo.updateIfStmt(db, id, setOf(after, now), selfGuard);
  return { payees, logs, rest, self };
}

const RECONCILED_DETAIL =
  "This transaction is reconciled: send confirm_reconciled true to change its amount, date, account or cleared state";

/** True when the patch changes a field that a reconciled transaction keeps unless the change is confirmed. */
function changesLocked(before: txRepo.TransactionDetailRow, p: TransactionUpdateRequest): boolean {
  return (
    (p.amount !== undefined && p.amount !== before.amount) ||
    (p.date !== undefined && p.date !== before.date) ||
    (p.account_id !== undefined && p.account_id !== before.accountId) ||
    (p.cleared !== undefined && p.cleared !== before.cleared) ||
    (p.transfer_account_id !== undefined && p.transfer_account_id !== before.transferAccountId)
  );
}

async function mutate(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
  kind: "update" | "delete",
  patch: TransactionUpdateRequest | undefined,
): Promise<TransactionDetail> {
  const db = getDb(env);
  const planRow = await activePlan(db, budgetId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await txRepo.findDetail(db, budgetId, id);
    if (!before) throw new NotFound("Transaction");
    if (
      before.cleared === "reconciled" &&
      (kind === "delete" || (patch && changesLocked(before, patch) && !patch.confirm_reconciled))
    ) {
      throw new TransactionRefused(409, "transaction_reconciled", RECONCILED_DETAIL);
    }
    const beforeAccount = await activeAccount(db, budgetId, before.accountId);
    const now = new Date().toISOString();
    const plan = await prepare(db, budgetId, before, beforeAccount, kind, patch, now, {
      singleUpdate: true,
      fmt: planFormatter(formatsOfRow(planRow)),
    });
    // Every statement runs only while the rows read above are unchanged; the row's own write comes last and
    // only succeeds when the other side's write did, so a lost race changes nothing and is retried.
    const moved =
      kind === "update" &&
      before.payeeSystem === "starting_balance" &&
      plan.after.accountId === before.accountId &&
      plan.after.date !== before.date &&
      beforeAccount.bankAccountId !== null;
    const next = moved
      ? importStartAfterMove(beforeAccount.importStartDate, before.date, plan.after.date)
      : null;
    // The new import start, only when it differs from the one read.
    const importNext = next !== null && next !== beforeAccount.importStartDate ? next : null;
    const guards = [
      txRepo.holdsAt(db, before),
      ...plan.others.flatMap((o) => (o.kind === "insert" ? [] : [txRepo.holdsAt(db, o.before)])),
      ...(importNext !== null ? [accountsRepo.importStartHolds(db, beforeAccount)] : []),
    ];
    const guard = guards.length > 1 ? txRepo.allHold(guards) : (guards[0] as SQLWrapper);
    // A linked Starting Balance's date move also moves the account's import start, in this same batch.
    const imp =
      importNext !== null
        ? await importStartStmts(db, actor, budgetId, beforeAccount, importNext, guard)
        : null;
    const lastOther = plan.others[plan.others.length - 1];
    const selfGuard =
      lastOther || imp
        ? txRepo.allHold([
            txRepo.holdsAt(db, before),
            ...(lastOther ? [txRepo.writtenAt(db, lastOther.row.id, now)] : []),
            ...(imp ? [imp.written] : []),
          ])
        : guard;
    const w0 = planWrites(db, { budgetId, actor, id, kind, plan, now, guard, selfGuard });
    const statements: unknown[] = [
      ...payeesRepo.livePayeesCheck(
        db,
        budgetId,
        kind === "delete" || plan.payeeCreates.some((c) => c.id === plan.after?.payeeId)
          ? []
          : [plan.after?.payeeId],
      ),
      ...w0.payees,
      ...w0.logs,
      ...(imp ? [imp.stmts[0]] : []),
      ...w0.rest,
      ...(imp ? [imp.stmts[1]] : []),
      w0.self,
    ];
    let results: Awaited<ReturnType<typeof db.batch>>;
    try {
      results = await db.batch(stmts(statements));
    } catch (e) {
      if (plan.payeeCreates.length > 0 && payeesRepo.isUniqueViolation(e)) continue;
      if (payeesRepo.isPayeeGone(e)) continue;
      throw e;
    }
    const w = results[results.length - 1] as { meta: { changes?: number } };
    if ((w.meta.changes ?? 0) > 0) {
      if (kind === "delete") {
        return transactionDetailToApi({ ...before, updatedAt: now }, plan.beforeLines);
      }
      return detailOf(db, budgetId, id);
    }
  }
  throw new Conflict("Transaction");
}

/**
 * What `prepare` needs for many rows, read once with set queries by the caller: the lines by parent id, the other
 * sides of transfers, the plan's accounts and the active categories (with their group names) the rows and the
 * change mention. With it `prepare` makes no database call, so a request over many rows makes a fixed number.
 */
export type Reads = {
  lines: ReadonlyMap<string, txRepo.LineRow[]>;
  others: ReadonlyMap<string, txRepo.TransactionDetailRow>;
  accounts: ReadonlyMap<string, accountsRepo.AccountRow>;
  categories: ReadonlyMap<
    string,
    { categoryName: string; groupName: string; kind: string | null; accountId: string | null }
  >;
};

export async function prepare(
  db: Db,
  budgetId: string,
  before: txRepo.TransactionDetailRow,
  beforeAccount: accountsRepo.AccountRow,
  kind: "update" | "delete",
  patch: TransactionUpdateRequest | undefined,
  now: string,
  opts: {
    allowReconciled?: boolean;
    singleUpdate?: boolean;
    reads?: Reads;
    /** The plan's formats for a refusal's text; the plan row the caller already read. */
    fmt?: PlanFormatter;
  } = {},
): Promise<Plan> {
  const reads = opts.reads;
  const namesFor = async (id: string | null | undefined) => {
    if (!reads) return namesOf(db, budgetId, id);
    const n = id ? reads.categories.get(id) : undefined;
    return { categoryName: n?.categoryName ?? null, groupName: n?.groupName ?? null };
  };
  const beforeLines = reads
    ? (reads.lines.get(before.id) ?? [])
    : await txRepo.listLines(db, budgetId, { parentId: before.id });
  const isSplit = beforeLines.length > 0;
  const beforeLog = logShape(before, beforeLines);
  const plan: Plan = {
    before,
    beforeLines,
    after: before,
    others: [],
    lines: { mode: "none", rows: [] },
    payeeCreates: [],
    logs: [],
  };
  const otherBefore = before.transferTransactionId
    ? reads
      ? reads.others.get(before.transferTransactionId)
      : await txRepo.findDetail(db, budgetId, before.transferTransactionId)
    : undefined;

  if (kind === "delete" || !patch) {
    if (otherBefore) {
      if (!(kind === "delete" && opts.allowReconciled)) refuseOtherReconciled(otherBefore);
      plan.others.push({ kind: "delete", before: otherBefore, row: otherBefore });
      plan.logs.push({
        action: "delete",
        entityType: "transaction",
        entityId: otherBefore.id,
        before: logShape(otherBefore),
        after: null,
      });
    }
    if (isSplit) plan.lines.mode = "remove";
    plan.logs.unshift({
      action: "delete",
      entityType: "transaction",
      entityId: before.id,
      before: beforeLog,
      after: null,
    });
    return plan;
  }

  const p = patch;
  // A single update (D4): the other side of a transfer keeps its lock only when a locked field changes unconfirmed.
  const refuseOther = (other: txRepo.TransactionDetailRow) => {
    if (opts.singleUpdate && !(changesLocked(before, p) && !p.confirm_reconciled)) return;
    refuseOtherReconciled(other);
  };
  const cleared = parseCleared(p.cleared);
  const readAccount = async (id: string) => {
    if (!reads) return activeAccount(db, budgetId, id);
    const a = reads.accounts.get(id);
    if (!a) throw new NotFound("Account");
    return a;
  };
  const account = p.account_id ? await readAccount(p.account_id) : beforeAccount;
  if (account.id !== before.accountId && account.closed) throw closedAccount(CLOSED_NO_MOVE);
  const isTransfer = Boolean(before.transferAccountId);
  const linesIn = p.subtransactions;
  const wantsLines = (linesIn?.length ?? 0) > 0;
  const toPlain = linesIn !== undefined && linesIn.length === 0;
  const tIn = p.transfer_account_id;
  const becomesTransfer = typeof tIn === "string" && tIn !== before.transferAccountId;
  const staysSplit = isSplit && !toPlain;
  const isSplitAfter = wantsLines || staysSplit;
  const transferAfterId = tIn === undefined ? (before.transferAccountId ?? null) : tIn;

  if (
    isCreditStartingBalance(beforeAccount, before) &&
    (linesIn !== undefined || tIn !== undefined)
  ) {
    throw new TransactionRefused(
      409,
      "starting_balance_locked",
      "A credit account's Starting Balance keeps its payee, category and account",
    );
  }
  if (before.payeeSystem && (wantsLines || becomesTransfer)) {
    throw unprocessable("A system payee's transaction cannot become a split or a transfer");
  }
  if (wantsLines && (isTransfer || typeof tIn === "string")) {
    throw unprocessable("A transfer cannot be split");
  }
  if (isSplit && typeof tIn === "string") throw unprocessable("A split cannot become a transfer");

  const hasPayeeFields = (p.payee_id ?? p.payee_name ?? null) !== null;
  if (transferAfterId && hasPayeeFields) {
    throw unprocessable("A transfer has no payee: its payee is the other account");
  }
  const payee = transferAfterId
    ? undefined
    : await resolvePayee(
        db,
        budgetId,
        { payee_id: p.payee_id, payee_name: p.payee_name },
        before.payeeId,
      );
  const after: txRepo.TransactionRow = {
    ...before,
    accountId: account.id,
    date: p.date ?? before.date,
    payeeId: payee ? payee.payeeId : before.payeeId,
    payeeName: payee ? payee.name : before.payeeName,
    categoryId: p.category_id === undefined ? before.categoryId : p.category_id,
    inflowToReadyToAssign: p.inflow_to_ready_to_assign ?? before.inflowToReadyToAssign,
    memo: p.memo === undefined ? before.memo : (clean(p.memo) ?? null),
    amount: p.amount ?? before.amount,
    cleared: cleared ?? before.cleared,
    // Saving an edit approves the row, unless the request says approved: false.
    approved: p.approved ?? true,
    flagColor: p.flag_color === undefined ? (before.flagColor ?? null) : p.flag_color,
  };
  plan.after = after;
  if (isTransfer && !transferAfterId) {
    // Leaving a transfer: the payee is the request's, else none.
    after.payeeId = payee?.payeeId ?? null;
    after.payeeName = payee?.name ?? null;
    after.transferAccountId = null;
    after.transferTransactionId = null;
  }
  if (
    isCreditStartingBalance(beforeAccount, before) &&
    (after.payeeId !== before.payeeId ||
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

  const sentCategory = (p.category_id ?? null) !== null || p.inflow_to_ready_to_assign === true;
  const lineRowsBefore = beforeLines;
  let afterLines: txRepo.LineRow[] = lineRowsBefore;

  if (isSplitAfter) {
    if (sentCategory) throw unprocessable("A split transaction's category is in its lines");
    after.categoryId = null;
    after.inflowToReadyToAssign = false;
    if (!account.onBudget) throw unprocessable("A tracking account's transactions cannot be split");
    if (wantsLines) {
      const r = await validateLines(
        db,
        budgetId,
        after,
        linesIn ?? [],
        account,
        now,
        payee,
        opts.fmt ?? DEFAULT_FORMATTER,
      );
      plan.payeeCreates.push(...r.payeeCreates);
      plan.lines = { mode: "replace", rows: r.rows };
      afterLines = await withLineNames(db, budgetId, r.rows);
    } else {
      if (p.amount !== undefined && p.amount !== before.amount) {
        throw unprocessable("A split's amount changes with its lines: send subtransactions too");
      }
      const changed =
        after.accountId !== before.accountId ||
        after.date !== before.date ||
        after.cleared !== before.cleared ||
        after.approved !== before.approved;
      if (changed) {
        plan.lines.mode = "sync";
        afterLines = beforeLines.map((l) => ({
          ...l,
          accountId: after.accountId,
          date: after.date,
          cleared: after.cleared,
          approved: after.approved,
        }));
      }
    }
  } else if (toPlain && isSplit) {
    plan.lines.mode = "remove";
    afterLines = [];
  }
  if (payee?.create) plan.payeeCreates.unshift(payee.create);

  let otherAccount: accountsRepo.AccountRow | undefined;
  if (transferAfterId) {
    // An existing transfer may point at an account closed since: only a new or changed link needs it open.
    otherAccount = await otherAccountOf(
      db,
      budgetId,
      account.id,
      transferAfterId,
      becomesTransfer,
      reads?.accounts,
    );
    after.payeeId = null;
    after.payeeName = transferPayeeName(otherAccount.name);
    after.transferAccountId = otherAccount.id;
    applyTransferRule(after, account, otherAccount, sentCategory);
  }
  await validate(db, budgetId, after, account, reads?.categories);

  if (transferAfterId && otherAccount) {
    if (isTransfer && !becomesTransfer && otherBefore) {
      // Same other account: mirror amount, date and memo, and follow an account move.
      const next = mirror(after, otherBefore);
      applyTransferRule(next, otherAccount, account, false);
      if (!sameSide(next, otherBefore)) {
        refuseOther(otherBefore);
        plan.others.push({ kind: "update", before: otherBefore, row: next });
        plan.logs.push({
          action: "update",
          entityType: "transaction",
          entityId: next.id,
          before: logShape(otherBefore),
          after: logShape({ ...next, ...(await namesFor(next.categoryId)) }),
        });
      }
    } else {
      // A plain row becomes a transfer, or a transfer points at another account: a new other side.
      // The insert comes first and the old side's delete last, so the row's own guard can rest on the
      // delete (which does not invalidate the others' guards before it runs).
      const side = newOtherSide(after, otherAccount.id, account.name, now);
      after.transferTransactionId = side.id;
      plan.others.push({ kind: "insert", row: side });
      plan.logs.push({
        action: "create",
        entityType: "transaction",
        entityId: side.id,
        before: null,
        after: logShape({ ...side, categoryName: null, groupName: null }),
      });
      if (otherBefore) {
        refuseOther(otherBefore);
        plan.others.push({ kind: "delete", before: otherBefore, row: otherBefore });
        plan.logs.push({
          action: "delete",
          entityType: "transaction",
          entityId: otherBefore.id,
          before: logShape(otherBefore),
          after: null,
        });
      }
    }
  } else if (otherBefore) {
    // Back to a plain transaction: the other side goes.
    refuseOther(otherBefore);
    plan.others.push({ kind: "delete", before: otherBefore, row: otherBefore });
    plan.logs.push({
      action: "delete",
      entityType: "transaction",
      entityId: otherBefore.id,
      before: logShape(otherBefore),
      after: null,
    });
  }

  const names =
    after.categoryId === before.categoryId
      ? { categoryName: before.categoryName, groupName: before.groupName }
      : await namesFor(after.categoryId);
  plan.logs.unshift({
    action: "update",
    entityType: "transaction",
    entityId: before.id,
    before: beforeLog,
    after: logShape({ ...after, ...names }, afterLines),
  });
  return plan;
}

export async function updateTransaction(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
  patch: TransactionUpdateRequest,
): Promise<TransactionDetail> {
  const p = TransactionUpdateRequest.parse(patch);
  const keys = Object.keys(p);
  if (keys.length === 1 && p.flag_color !== undefined) {
    // A flag alone neither approves the row nor is refused for a reconciled one.
    const found = await txRepo.findDetail(getDb(env), budgetId, id);
    if (!found) {
      await activePlan(getDb(env), budgetId);
      throw new NotFound("Transaction");
    }
    await bulkTransactions(env, actor, budgetId, { op: "flag", ids: [id], value: p.flag_color });
    return getTransaction(env, budgetId, id);
  }
  return mutate(env, actor, budgetId, id, "update", p);
}

export async function deleteTransaction(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
): Promise<TransactionDetail> {
  return mutate(env, actor, budgetId, id, "delete", undefined);
}

/** Distinct ids in the order first given. */
const distinct = (ids: readonly string[]) => [...new Set(ids)];

async function readAll(db: Db, budgetId: string, ids: readonly string[]) {
  const found = await txRepo.findDetailMany(db, budgetId, ids);
  return ids.map((id) => {
    const r = found.get(id);
    if (!r) throw new NotFound("Transaction");
    return r;
  });
}

/** The lines (by parent) and the transfer other sides of these rows, in two set queries. */
async function linksOf(db: Db, budgetId: string, rows: readonly txRepo.TransactionDetailRow[]) {
  const lines = linesByParent(
    await txRepo.listLines(db, budgetId, { parentIds: rows.map((r) => r.id) }),
  );
  const otherIds = rows.flatMap((r) => (r.transferTransactionId ? [r.transferTransactionId] : []));
  return { lines, others: await txRepo.findDetailMany(db, budgetId, otherIds) };
}

/** The rows as the API shows them, read with two set queries. */
export async function detailsOf(db: Db, budgetId: string, ids: readonly string[]) {
  const rows = await readAll(db, budgetId, ids);
  const lines = linesByParent(await txRepo.listLines(db, budgetId, { parentIds: ids }));
  return rows.map((r) => transactionDetailToApi(r, lines.get(r.id) ?? []));
}

/**
 * Approves the transactions (1 to 100): each row, its split lines and the other side of a transfer. An
 * approved row is returned as it is, with no write. Any unknown id refuses the whole request first.
 */
export async function approveTransactions(
  env: Env,
  actor: string,
  budgetId: string,
  ids: readonly string[],
): Promise<TransactionDetail[]> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  const wanted = distinct(ids);
  let pending = wanted;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && pending.length > 0; attempt++) {
    const rows = (await readAll(db, budgetId, pending)).filter((r) => !r.approved);
    const links = await linksOf(db, budgetId, rows);
    const now = new Date().toISOString();
    const covered = new Set<string>();
    const groups: StatementGroup[] = [];
    const owners: string[] = [];
    for (const row of rows) {
      if (covered.has(row.id)) continue;
      const lines = links.lines.get(row.id) ?? [];
      const other = row.transferTransactionId
        ? links.others.get(row.transferTransactionId)
        : undefined;
      const otherOpen = other && !other.approved ? other : undefined;
      covered.add(row.id);
      if (otherOpen) covered.add(otherOpen.id);
      const guards = [
        txRepo.holdsAt(db, row),
        ...(otherOpen ? [txRepo.holdsAt(db, otherOpen)] : []),
      ];
      const guard = guards.length > 1 ? txRepo.allHold(guards) : (guards[0] as SQLWrapper);
      const stmts: unknown[] = [
        changeLogInsertIf(
          db,
          {
            budgetId,
            actor,
            action: "update",
            entityType: "transaction",
            entityId: row.id,
            before: logShape(row, lines),
            after: logShape({ ...row, approved: true }, lines),
          },
          guard,
        ),
      ];
      if (otherOpen) {
        stmts.push(
          changeLogInsertIf(
            db,
            {
              budgetId,
              actor,
              action: "update",
              entityType: "transaction",
              entityId: otherOpen.id,
              before: logShape(otherOpen),
              after: logShape({ ...otherOpen, approved: true }),
            },
            guard,
          ),
        );
      }
      if (lines.length > 0) {
        stmts.push(
          txRepo.syncLinesIfStmt(
            db,
            row.id,
            {
              accountId: row.accountId,
              date: row.date,
              cleared: row.cleared,
              approved: true,
              updatedAt: now,
            },
            guard,
          ),
        );
      }
      if (otherOpen) {
        stmts.push(
          txRepo.updateIfStmt(db, otherOpen.id, { approved: true, updatedAt: now }, guard),
        );
      }
      // The row's own write comes last, and only succeeds when the other side's did.
      const selfGuard = otherOpen
        ? txRepo.allHold([txRepo.holdsAt(db, row), txRepo.writtenAt(db, otherOpen.id, now)])
        : guard;
      stmts.push(txRepo.updateIfStmt(db, row.id, { approved: true, updatedAt: now }, selfGuard));
      groups.push(stmts);
      owners.push(row.id);
    }
    // One batch for every row: a batch is one D1 call whatever its size.
    const results = await runGroups(db, groups, Number.MAX_SAFE_INTEGER);
    pending = owners.filter((_, i) => (results[i]?.[(results[i]?.length ?? 1) - 1] ?? 0) === 0);
    // A request id that was the other side of a covered row is done when that row was.
    if (pending.length === 0) break;
  }
  if (pending.length > 0) throw new Conflict("Transaction");
  return detailsOf(db, budgetId, wanted);
}

/**
 * Rejects unapproved imports: each is deleted and its import id recorded, so it never comes back.
 * Refused without a write when an id is unknown (404), approved (409) or not an import (422).
 */
export async function rejectTransactions(
  env: Env,
  actor: string,
  budgetId: string,
  ids: readonly string[],
): Promise<TransactionDetail[]> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  const wanted = distinct(ids);
  const out = new Map<string, TransactionDetail>();
  let pending = wanted;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && pending.length > 0; attempt++) {
    const rows = await readAll(db, budgetId, pending);
    for (const r of rows) {
      if (r.approved) {
        throw new TransactionRefused(
          409,
          "transaction_approved",
          "An approved transaction cannot be rejected",
        );
      }
    }
    for (const r of rows) {
      if (!r.importId || r.transferTransactionId) {
        throw new TransactionRefused(
          422,
          "not_imported",
          "Only an imported transaction can be rejected",
        );
      }
    }
    const now = new Date().toISOString();
    const groups: StatementGroup[] = [];
    const details: TransactionDetail[] = [];
    const { lines: linesOfRow } = await linksOf(db, budgetId, rows);
    for (const row of rows) {
      const lines = linesOfRow.get(row.id) ?? [];
      const guard = txRepo.holdsAt(db, row);
      groups.push([
        changeLogInsertIf(
          db,
          {
            budgetId,
            actor,
            action: "delete",
            entityType: "transaction",
            entityId: row.id,
            before: logShape(row, lines),
            after: null,
          },
          guard,
        ),
        importsRepo.tombstoneIfStmt(
          db,
          {
            accountId: row.accountId,
            importId: row.importId as string,
            budgetId,
            reason: "rejected",
            transactionId: row.id,
          },
          guard,
          now,
        ),
        txRepo.softDeleteLinesIfStmt(db, row.id, now, guard),
        txRepo.softDeleteIfStmt(db, row.id, now, guard),
      ]);
      details.push(transactionDetailToApi(row, lines));
    }
    // One batch for every row, so the window between the checks and the writes is as small as it can be.
    const results = await runGroups(db, groups, Number.MAX_SAFE_INTEGER);
    pending = [];
    for (const [i, row] of rows.entries()) {
      const r = results[i] ?? [];
      if ((r[r.length - 1] ?? 0) > 0) out.set(row.id, details[i] as TransactionDetail);
      else pending.push(row.id);
    }
  }
  if (pending.length > 0) throw new Conflict("Transaction");
  return wanted.map((id) => out.get(id) as TransactionDetail);
}
