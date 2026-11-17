import {
  CREDIT_ACCOUNT_TYPES,
  displayGroup,
  isLoanType,
  isOnBudget,
  STARTING_BALANCE_PAYEE,
  startingBalanceAmount,
  startingBalanceFeedsReadyToAssign,
} from "@budget/core/account-types";
import {
  type Account,
  AccountAdjustBalanceRequest,
  type AccountAdjustBalanceRequest as AccountAdjustBalanceRequestInput,
  AccountCloseRequest,
  type AccountCloseRequest as AccountCloseRequestInput,
  AccountCreate,
  AccountCreateRequest,
  type AccountCreateRequest as AccountCreateRequestInput,
  type AccountType,
  AccountUpdateRequest,
  type AccountUpdateRequest as AccountUpdateRequestInput,
  CLOSED_ACCOUNT_MEMO,
  MANUAL_ADJUSTMENT_PAYEE,
} from "@budget/schema/accounts";
import type { PayeeSystem } from "@budget/schema/payees";
import type { AccountBalances, Transaction } from "@budget/schema/transactions";
import { type SQL, sql } from "drizzle-orm";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as bankRepo from "../repositories/bank-connections";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as payeesRepo from "../repositories/payees";
import * as txRepo from "../repositories/transactions";
import {
  PAYMENT_HISTORY_TEXT,
  paymentCreateStmts,
  paymentDeleteStmts,
  paymentRenameStmts,
} from "./credit-payments";
import { transactionToApi } from "./transactions";

const MAX_ATTEMPTS = 5;

export class NameTaken extends Error {
  constructor() {
    super("This account name already exists.");
  }
}

/** A link rule failed; the route answers with this status and code. */
export class LinkRefused extends Error {
  constructor(
    readonly status: 409 | 422,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "LinkRefused";
  }
}

export class UnsupportedAccountType extends Error {
  constructor() {
    super(
      "Loan accounts (mortgage, autoLoan, studentLoan, personalLoan, medicalDebt, otherDebt) are not supported yet",
    );
  }
}

export type AccountFacts = {
  cleared: number;
  uncleared: number;
  canDelete: boolean;
  unapproved: number;
  attention: number;
};

/** Open: no transaction or only its Starting Balance. Closed: no transaction at all. */
function canDeleteFrom(
  row: { closed: boolean },
  f: { count: number; startingId: string | null } | undefined,
): boolean {
  const count = f?.count ?? 0;
  return row.closed ? count === 0 : count === 0 || (count === 1 && f?.startingId != null);
}

/** Balances and `can_delete` of the plan's accounts (or one), as a function of the account row. */
export async function accountFacts(
  db: Db,
  budgetId: string,
  accountId?: string,
): Promise<(row: accountsRepo.AccountRow) => AccountFacts> {
  const [balances, tx, attention] = await Promise.all([
    txRepo.balancesByAccount(db, budgetId, accountId),
    accountsRepo.transactionFacts(db, budgetId, accountId),
    txRepo.attentionCountsByAccount(db, budgetId, accountId),
  ]);
  return (row) => ({
    cleared: balances.get(row.id)?.cleared ?? 0,
    uncleared: balances.get(row.id)?.uncleared ?? 0,
    canDelete: canDeleteFrom(row, tx.get(row.id)),
    unapproved: attention.get(row.id)?.unapproved ?? 0,
    attention: attention.get(row.id)?.attention ?? 0,
  });
}

export function accountToApi(
  row: accountsRepo.AccountRow,
  b: {
    cleared: number;
    uncleared: number;
    canDelete?: boolean;
    unapproved?: number;
    attention?: number;
  } = { cleared: 0, uncleared: 0 },
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
    bank_account_id: row.bankAccountId,
    linked: row.bankAccountId !== null,
    import_start_date: row.importStartDate,
    last_reconciled_at: row.lastReconciledAt,
    can_delete: b.canDelete ?? true,
    unapproved_count: b.unapproved ?? 0,
    needs_attention_count: b.attention ?? 0,
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
      bankAccountId: null,
      importStartDate: null,
      lastReconciledAt: null,
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
      ...paymentCreateStmts(db, {
        actor,
        budgetId: row.budgetId,
        accountId: row.id,
        name: row.name,
        type: row.type,
        now: new Date().toISOString(),
        accountExists: sql`exists ${accountsRepo.existsStmt(db, row.id)}`,
      }),
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
  const [rows, facts] = await Promise.all([
    accountsRepo.list(db, budgetId, { includeClosed: opts.includeClosed ?? true }),
    accountFacts(db, budgetId),
  ]);
  return rows.map((r) => accountToApi(r, facts(r)));
}

export async function getAccount(env: Env, budgetId: string, accountId: string): Promise<Account> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const row = await accountsRepo.findActive(db, budgetId, accountId);
  if (!row) throw new NotFound("Account");
  return accountToApi(row, (await accountFacts(db, budgetId, accountId))(row));
}

/** A rule of the account routes failed; the route answers with this status and code. */
export class AccountRefused extends Error {
  constructor(
    detail: string,
    readonly status: 409 | 422 = 422,
    readonly code = "unprocessable_entity",
  ) {
    super(detail);
    this.name = "AccountRefused";
  }
}

const isCreditAccountType = (t: string) => (CREDIT_ACCOUNT_TYPES as readonly string[]).includes(t);

const utcToday = () => new Date().toISOString().slice(0, 10);

/** Renames, sets the note and stars. One history row per real change; a closed account cannot be starred. */
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
  const name = patch.name?.trim();
  if (name === "") throw new AccountRefused("The account name is required.", 422, "name_required");
  const note = patch.note === undefined ? undefined : patch.note?.trim() ? patch.note : null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await accountsRepo.findActive(db, budgetId, accountId);
    if (!before) throw new NotFound("Account");
    if (patch.starred === true && before.closed) {
      throw new AccountRefused("A closed account cannot be starred");
    }
    const set: { name?: string; note?: string | null; starred?: boolean } = {};
    if (name !== undefined && name !== before.name) set.name = name;
    if (note !== undefined && note !== before.note) set.note = note;
    if (patch.starred !== undefined && patch.starred !== before.starred) {
      set.starred = patch.starred;
    }
    const facts = (await accountFacts(db, budgetId, accountId))(before);
    if (Object.keys(set).length === 0) return accountToApi(before, facts);
    if (
      set.name !== undefined &&
      (await accountsRepo.nameTakenByOther(db, budgetId, accountId, set.name))
    ) {
      throw new NameTaken();
    }
    const after = { ...before, ...set };
    const extra =
      set.name === undefined ? undefined : accountsRepo.nameFree(budgetId, accountId, set.name);
    const renameStmts =
      set.name !== undefined && isCreditAccountType(before.type)
        ? paymentRenameStmts(db, {
            actor,
            budgetId,
            accountId,
            name: set.name,
            now: new Date().toISOString(),
            guard: sql`exists ${accountsRepo.accountHolds(db, before, extra)}`,
          })
        : [];
    const results = await db.batch([
      ...renameStmts,
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "account",
          entityId: accountId,
          before: accountToApi(before, facts),
          after: accountToApi(after, facts),
        },
        accountsRepo.accountHolds(db, before, extra),
      ),
      accountsRepo.updateFieldsIfStmt(db, before, set, extra),
    ] as unknown as [BatchItem, ...BatchItem[]]);
    if ((results[results.length - 1]?.meta.changes ?? 0) > 0) return accountToApi(after, facts);
  }
  throw new Conflict("Account");
}

export type BatchItem = Parameters<Db["batch"]>[0][number];

/** The system payee row of a kind, as found or as new; `stmts` create it (with their log row) when new. */
export function systemPayee(
  db: Db,
  actor: string,
  budgetId: string,
  existing: payeesRepo.PayeeRow | undefined,
  system: PayeeSystem,
  name: string,
  now: string,
): { sys: payeesRepo.PayeeRow; stmts: BatchItem[] } {
  const sys: payeesRepo.PayeeRow = existing ?? {
    id: crypto.randomUUID(),
    budgetId,
    name,
    hidden: false,
    system,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  if (existing) return { sys, stmts: [] };
  return {
    sys,
    stmts: [
      payeesRepo.insertSystemIfMissingStmt(db, sys),
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "create",
          entityType: "payee",
          entityId: sys.id,
          before: null,
          after: { id: sys.id, name: sys.name, hidden: false, system: sys.system },
        },
        payeesRepo.existsStmt(db, sys.id),
      ),
    ],
  };
}

/** The adjustment's row: cleared, approved, to Ready to Assign for on-plan accounts, no category. */
export function adjustmentRow(
  row: accountsRepo.AccountRow,
  sys: payeesRepo.PayeeRow,
  amount: number,
  date: string,
  memo: string | null,
  now: string,
  opts: { payeeName?: string; cleared?: "cleared" | "reconciled" } = {},
): txRepo.TransactionRow {
  return {
    id: crypto.randomUUID(),
    budgetId: row.budgetId,
    accountId: row.id,
    date,
    payeeId: sys.id,
    payeeName: opts.payeeName ?? MANUAL_ADJUSTMENT_PAYEE,
    categoryId: null,
    inflowToReadyToAssign: row.onBudget,
    memo,
    amount,
    cleared: opts.cleared ?? "cleared",
    approved: true,
    createdAt: now,
    deletedAt: null,
    updatedAt: now,
  };
}

async function readAdjustment(db: Db, budgetId: string, tx: txRepo.TransactionRow) {
  const linked = await payeesRepo.findSystem(db, budgetId, "manual_adjustment");
  return transactionToApi({ ...tx, payeeId: linked?.id ?? null });
}

/** Sets an open account's working balance by adding a "Manual Balance Adjustment" for the difference. */
export async function adjustBalance(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
  input: AccountAdjustBalanceRequestInput,
): Promise<{ account: Account; adjustment: Transaction | null }> {
  const v = AccountAdjustBalanceRequest.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await accountsRepo.findActive(db, budgetId, accountId);
    if (!before) throw new NotFound("Account");
    if (before.closed) {
      throw new AccountRefused(
        "A closed account's balance cannot be adjusted",
        422,
        "account_closed",
      );
    }
    const facts = (await accountFacts(db, budgetId, accountId))(before);
    const working = facts.cleared + facts.uncleared;
    const delta = v.balance - working;
    if (delta === 0) return { account: accountToApi(before, facts), adjustment: null };
    const now = new Date().toISOString();
    const existing = await payeesRepo.findSystem(db, budgetId, "manual_adjustment");
    const { sys, stmts } = systemPayee(
      db,
      actor,
      budgetId,
      existing,
      "manual_adjustment",
      MANUAL_ADJUSTMENT_PAYEE,
      now,
    );
    const tx = adjustmentRow(before, sys, delta, v.today ?? utcToday(), null, now);
    const guard = accountsRepo.accountHolds(
      db,
      before,
      accountsRepo.accountSumIs(accountId, working),
    );
    const after = accountToApi(before, {
      cleared: facts.cleared + delta,
      uncleared: facts.uncleared,
      canDelete: false,
    });
    const txExists = accountsRepo.transactionExistsStmt(db, tx.id);
    const results = await db.batch([
      ...stmts,
      txRepo.insertIfStmt(db, tx, guard, payeesRepo.systemIdSql(budgetId, "manual_adjustment")),
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
        txExists,
      ),
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "account",
          entityId: accountId,
          before: accountToApi(before, facts),
          after,
        },
        txExists,
      ),
    ] as unknown as [BatchItem, ...BatchItem[]]);
    if ((results[stmts.length]?.meta.changes ?? 0) > 0) {
      return { account: after, adjustment: await readAdjustment(db, budgetId, tx) };
    }
  }
  throw new Conflict("Account");
}

/** Closes the account: zeroes a non-zero balance with a "Closed Account" adjustment, unstars and unlinks it. */
export async function closeAccount(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
  input: AccountCloseRequestInput = {},
): Promise<{ account: Account; adjustment: Transaction | null }> {
  const v = AccountCloseRequest.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await accountsRepo.findActive(db, budgetId, accountId);
    if (!before) throw new NotFound("Account");
    const facts = (await accountFacts(db, budgetId, accountId))(before);
    if (before.closed) return { account: accountToApi(before, facts), adjustment: null };
    const working = facts.cleared + facts.uncleared;
    const now = new Date().toISOString();
    const existing = await payeesRepo.findSystem(db, budgetId, "manual_adjustment");
    const { sys, stmts } =
      working === 0
        ? { sys: existing, stmts: [] as BatchItem[] }
        : systemPayee(
            db,
            actor,
            budgetId,
            existing,
            "manual_adjustment",
            MANUAL_ADJUSTMENT_PAYEE,
            now,
          );
    const tx = sys
      ? adjustmentRow(before, sys, -working, v.today ?? utcToday(), CLOSED_ACCOUNT_MEMO, now)
      : null;
    const adjusting = working !== 0 && tx !== null;
    const txFacts = (await accountsRepo.transactionFacts(db, budgetId, accountId)).get(accountId);
    const afterRow = {
      ...before,
      closed: true,
      starred: false,
      bankAccountId: null,
      importStartDate: null,
      lastReconciledAt: null,
    };
    const after = accountToApi(afterRow, {
      cleared: facts.cleared - working,
      uncleared: facts.uncleared,
      canDelete: canDeleteFrom(afterRow, {
        count: (txFacts?.count ?? 0) + (adjusting ? 1 : 0),
        startingId: txFacts?.startingId ?? null,
      }),
    });
    const guard = accountsRepo.accountHolds(
      db,
      before,
      accountsRepo.accountSumIs(accountId, working),
    );
    const closeGuard =
      adjusting && tx
        ? sql`${accountsRepo.accountSumIs(accountId, 0)} and exists ${accountsRepo.transactionExistsStmt(db, tx.id)}`
        : accountsRepo.accountSumIs(accountId, 0);
    const accountLog = changeLogInsertIf(
      db,
      {
        budgetId,
        actor,
        action: "update",
        entityType: "account",
        entityId: accountId,
        before: accountToApi(before, facts),
        after: { ...after, adjustment_id: adjusting && tx ? tx.id : null },
      },
      // With an adjustment, the row is logged only once it has been inserted under `guard`.
      adjusting && tx ? accountsRepo.transactionExistsStmt(db, tx.id) : guard,
    );
    const results = await db.batch([
      ...(adjusting ? stmts : []),
      ...(adjusting && tx
        ? [
            txRepo.insertIfStmt(
              db,
              tx,
              guard,
              payeesRepo.systemIdSql(budgetId, "manual_adjustment"),
            ),
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
              accountsRepo.transactionExistsStmt(db, tx.id),
            ),
          ]
        : []),
      accountLog,
      accountsRepo.closeIfStmt(db, before, closeGuard),
    ] as unknown as [BatchItem, ...BatchItem[]]);
    if ((results[results.length - 1]?.meta.changes ?? 0) > 0) {
      return {
        account: after,
        adjustment: adjusting && tx ? await readAdjustment(db, budgetId, tx) : null,
      };
    }
  }
  throw new Conflict("Account");
}

/** Re-opens a closed account. The closing adjustment stays and the star is not restored. */
export async function reopenAccount(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
): Promise<Account> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await accountsRepo.findActive(db, budgetId, accountId);
    if (!before) throw new NotFound("Account");
    const facts = (await accountFacts(db, budgetId, accountId))(before);
    if (!before.closed) return accountToApi(before, facts);
    const afterRow = { ...before, closed: false };
    const txFacts = (await accountsRepo.transactionFacts(db, budgetId, accountId)).get(accountId);
    const after = accountToApi(afterRow, { ...facts, canDelete: canDeleteFrom(afterRow, txFacts) });
    const [, result] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "account",
          entityId: accountId,
          before: accountToApi(before, facts),
          after,
        },
        accountsRepo.accountHolds(db, before),
      ),
      accountsRepo.reopenIfStmt(db, before),
    ]);
    if (result.meta.changes > 0) return after;
  }
  throw new Conflict("Account");
}

const HAS_TX =
  "This account has transactions other than its Starting Balance, so it cannot be deleted. Close it instead to keep its history.";
const CLOSED_HAS_TX =
  "This account has transactions, so it cannot be deleted. Delete all of its transactions first.";

/** Soft-deletes an account and its Starting Balance, when that is its only transaction. */
export async function deleteAccount(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
): Promise<{ account_id: string; deleted_transaction_ids: string[] }> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await accountsRepo.findActive(db, budgetId, accountId);
    if (!before) throw new NotFound("Account");
    const facts = (await accountFacts(db, budgetId, accountId))(before);
    if (!facts.canDelete) {
      throw new AccountRefused(before.closed ? CLOSED_HAS_TX : HAS_TX, 409, "has_transactions");
    }
    const startingId =
      (await accountsRepo.transactionFacts(db, budgetId, accountId)).get(accountId)?.startingId ??
      null;
    const startingTx = startingId ? await txRepo.findDetail(db, budgetId, startingId) : undefined;
    if (startingId && !startingTx) continue;
    const at = new Date().toISOString();
    const stmts: BatchItem[] = [];
    const payment = isCreditAccountType(before.type)
      ? await categoriesRepo.findPaymentCategory(db, accountId)
      : undefined;
    if (payment) {
      const history = await categoriesRepo.historyOf(db, budgetId, [payment.id]);
      if (history.transactions > 0 || history.assignedMonths > 0) {
        throw new AccountRefused(PAYMENT_HISTORY_TEXT, 409, "payment_category_has_history");
      }
    }
    // The account's own writes also hold only while its payment category has no history, so money that lands
    // on the category between the read above and the batch cannot orphan it.
    const payClear = (except: string | null): SQL =>
      payment
        ? sql`${accountsRepo.noOtherTransactions(accountId, except)} and not exists (select 1 from transactions t where t.budget_id = ${budgetId} and t.deleted_at is null and t.category_id = ${payment.id}) and not exists (select 1 from month_categories m where m.budget_id = ${budgetId} and m.assigned <> 0 and m.category_id = ${payment.id})`
        : accountsRepo.noOtherTransactions(accountId, except);
    if (startingId && startingTx) {
      stmts.push(
        changeLogInsertIf(
          db,
          {
            budgetId,
            actor,
            action: "delete",
            entityType: "transaction",
            entityId: startingId,
            before: transactionToApi(startingTx),
            after: null,
          },
          accountsRepo.accountHolds(db, before, payClear(startingId)),
        ),
        accountsRepo.softDeleteStartingBalanceStmt(
          db,
          before,
          startingId,
          at,
          payClear(startingId),
        ),
      );
    }
    if (payment) {
      stmts.push(
        ...paymentDeleteStmts(db, {
          actor,
          budgetId,
          accountId,
          now: at,
          guard: sql`exists ${accountsRepo.accountHolds(db, before, accountsRepo.noOtherTransactions(accountId, null))}`,
        }),
      );
    }
    stmts.push(
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "delete",
          entityType: "account",
          entityId: accountId,
          before: accountToApi(before, facts),
          after: null,
        },
        accountsRepo.accountHolds(db, before, payClear(null)),
      ),
      accountsRepo.softDeleteIfStmt(db, before, at, payClear(null)),
    );
    const results = await db.batch(stmts as unknown as [BatchItem, ...BatchItem[]]);
    if ((results[results.length - 1]?.meta.changes ?? 0) > 0) {
      return { account_id: accountId, deleted_transaction_ids: startingId ? [startingId] : [] };
    }
    if (payment) {
      const history = await categoriesRepo.historyOf(db, budgetId, [payment.id]);
      if (history.transactions > 0 || history.assignedMonths > 0) {
        throw new AccountRefused(PAYMENT_HISTORY_TEXT, 409, "payment_category_has_history");
      }
    }
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
  return insertAccountWithStartingBalance(env, actor, budgetId, {
    name: v.name,
    type: v.type,
    amount: startingBalanceAmount(v.type, v.balance),
    date: v.date ?? opts.today ?? new Date().toISOString().slice(0, 10),
    bankAccountId: null,
    importStartDate: null,
  });
}

/**
 * The guarded create behind Add Account and "add from bank": the account, the system payee when missing
 * and the Starting Balance, each with its change_log row, in one batch.
 */
export async function insertAccountWithStartingBalance(
  env: Env,
  actor: string,
  budgetId: string,
  spec: {
    name: string;
    type: AccountType;
    amount: number;
    date: string;
    bankAccountId: string | null;
    importStartDate: string | null;
  },
): Promise<{ account: Account; starting_balance: Transaction }> {
  const db = getDb(env);
  const { amount } = spec;
  const existingSystem = await payeesRepo.findSystem(db, budgetId, "starting_balance");
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const now = new Date().toISOString();
    const row: accountsRepo.AccountRow = {
      id: crypto.randomUUID(),
      budgetId,
      name: spec.name,
      type: spec.type,
      onBudget: isOnBudget(spec.type),
      note: null,
      starred: false,
      closed: false,
      sortOrder: (await accountsRepo.maxSort(db, budgetId)) + 1,
      createdAt: now,
      deletedAt: null,
      bankAccountId: spec.bankAccountId,
      importStartDate: spec.importStartDate,
      lastReconciledAt: null,
    };
    const { sys, stmts: payeeStmts } = systemPayee(
      db,
      actor,
      budgetId,
      existingSystem,
      "starting_balance",
      STARTING_BALANCE_PAYEE,
      now,
    );
    const tx: txRepo.TransactionRow = {
      id: crypto.randomUUID(),
      budgetId,
      accountId: row.id,
      date: spec.date,
      payeeId: sys.id,
      payeeName: STARTING_BALANCE_PAYEE,
      categoryId: null,
      inflowToReadyToAssign: startingBalanceFeedsReadyToAssign(spec.type),
      memo: null,
      amount,
      cleared: "cleared",
      approved: true,
      createdAt: now,
      deletedAt: null,
      updatedAt: now,
    };
    const account = accountToApi(row, { cleared: amount, uncleared: 0, canDelete: true });
    const g1 = accountsRepo.newAccountGuard(
      db,
      budgetId,
      row.sortOrder,
      row.name,
      spec.bankAccountId,
    );
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
      ...payeeStmts,
      txRepo.insertIfStmt(db, tx, g2, payeesRepo.systemIdSql(budgetId, "starting_balance")),
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
      ...paymentCreateStmts(db, {
        actor,
        budgetId,
        accountId: row.id,
        name: row.name,
        type: row.type,
        now,
        accountExists: sql`exists ${g2}`,
      }),
    ]);
    if (result.meta.changes > 0) {
      const linked = await payeesRepo.findSystem(db, budgetId, "starting_balance");
      return {
        account,
        starting_balance: transactionToApi({ ...tx, payeeId: linked?.id ?? null }),
      };
    }
    if (await accountsRepo.nameTaken(db, budgetId, spec.name)) throw new NameTaken();
    if (spec.bankAccountId !== null) {
      const holder = await accountsRepo.findByBankAccount(db, budgetId, spec.bankAccountId);
      if (holder) {
        throw new LinkRefused(
          409,
          "bank_account_already_linked",
          `This bank account is already linked to the account "${holder.name}" in this plan`,
        );
      }
      if (!(await bankRepo.findBankAccountById(db, spec.bankAccountId))) {
        throw new NotFound("Bank account");
      }
    }
  }
  throw new Conflict("Account order");
}
