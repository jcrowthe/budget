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
  canonicalInterestRate,
  MANUAL_ADJUSTMENT_PAYEE,
} from "@budget/schema/accounts";
import type { PayeeSystem } from "@budget/schema/payees";
import { statusReason } from "@budget/schema/plaid-import";
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
import * as groupsRepo from "../repositories/category-groups";
import { whenQuery } from "../repositories/guards";
import * as payeesRepo from "../repositories/payees";
import * as txRepo from "../repositories/transactions";
import { CATEGORY_NAME_TAKEN, categoryToApi, GROUP_NAME_TAKEN, groupToApi } from "./categories";
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

/** A loan rule failed (an unusable pairing target, a taken category or group name): the route answers 422. */
export class LoanRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "LoanRefused";
  }
}

/** What a loan create records, resolved against the plan before the batch. */
type LoanSpec = {
  interestRate: string;
  minimumPayment: number;
  escrowAmount: number;
  /** An existing category to pair with. */
  pairedCategoryId: string | null;
  /** A category to create and pair: in `groupId`, or in a new group named `newGroupName`. */
  newCategory: { name: string; groupId: string | null; newGroupName: string | null } | null;
};

export type AccountFacts = {
  cleared: number;
  uncleared: number;
  /** A loan's computed interest and escrow, already in `cleared`; SQL sums over stored rows lack it. */
  estimated: number;
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
    estimated: balances.get(row.id)?.estimated ?? 0,
    canDelete: canDeleteFrom(row, tx.get(row.id)),
    unapproved: attention.get(row.id)?.unapproved ?? 0,
    attention: attention.get(row.id)?.attention ?? 0,
  });
}

const CONNECTION_STATUSES = ["connected", "delayed", "login_required", "broken"] as const;
const asStatus = (s: string | null | undefined) => CONNECTION_STATUSES.find((c) => c === s) ?? null;

export function accountToApi(
  row: accountsRepo.AccountRow &
    Partial<
      Pick<
        accountsRepo.AccountReadRow,
        "connectionStatus" | "connectionSyncedAt" | "connectionErrorCode"
      >
    >,
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
    connection_status: row.bankAccountId === null ? null : asStatus(row.connectionStatus),
    last_synced_at: row.bankAccountId === null ? null : (row.connectionSyncedAt ?? null),
    connection_reason:
      row.bankAccountId === null
        ? null
        : statusReason(row.connectionStatus ?? "", row.connectionErrorCode ?? null),
    link_missing_since: row.bankAccountId === null ? null : row.linkMissingSince,
    interest_rate: row.interestRate,
    minimum_payment: row.minimumPayment,
    escrow_amount: row.escrowAmount,
    paired_category_id: row.pairedCategoryId,
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
      linkMissingSince: null,
      interestRate: null,
      minimumPayment: null,
      escrowAmount: null,
      pairedCategoryId: null,
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
  return accountList(db, budgetId, opts.includeClosed ?? true);
}

/** The plan's accounts in display order with their facts (the plan is not checked here). */
export async function accountList(
  db: Db,
  budgetId: string,
  includeClosed: boolean,
): Promise<Account[]> {
  const [rows, facts] = await Promise.all([
    accountsRepo.list(db, budgetId, { includeClosed }),
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
      accountsRepo.accountSumIs(accountId, working - facts.estimated),
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
      accountsRepo.accountSumIs(accountId, working - facts.estimated),
    );
    const closeGuard =
      adjusting && tx
        ? sql`${accountsRepo.accountSumIs(accountId, -facts.estimated)} and exists ${accountsRepo.transactionExistsStmt(db, tx.id)}`
        : accountsRepo.accountSumIs(accountId, -facts.estimated);
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
  return { cleared: b.cleared, uncleared: b.uncleared, working: b.cleared + b.uncleared };
}

/**
 * Creates an unlinked account and its Starting Balance transaction in one batch. The guards make the name
 * check and the sort order hold inside the write, so two simultaneous creates with one name leave one account.
 * A loan also records its rate, payment, escrow and pairing; a new paired category (and group) is created in
 * the same batch.
 */
export async function addUnlinkedAccount(
  env: Env,
  actor: string,
  budgetId: string,
  input: AccountCreateRequestInput,
  opts: { today?: string } = {},
): Promise<{ account: Account; starting_balance: Transaction }> {
  const v = AccountCreateRequest.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  if (await accountsRepo.nameTaken(db, budgetId, v.name)) throw new NameTaken();
  const loan = isLoanType(v.type) ? await resolveLoan(db, budgetId, v) : undefined;
  return insertAccountWithStartingBalance(env, actor, budgetId, {
    name: v.name,
    type: v.type,
    amount: startingBalanceAmount(v.type, v.balance),
    date: v.date ?? opts.today ?? new Date().toISOString().slice(0, 10),
    bankAccountId: null,
    importStartDate: null,
    loan,
  });
}

const UNPAIRABLE_CATEGORY =
  "paired_category_id must be an active, visible category of this plan that is not a payment category";
const UNPAIRABLE_GROUP =
  "group_id must be an active, visible category group of this plan that is not Credit Card Payments";

type NewCategoryInput = { name: string; group_id?: string; new_group_name?: string };

/**
 * A new paired category checked against the plan with constant reads (the batch guards repeat the checks): its
 * group must be usable and the name free, or the new group's name free. Shared by the create flow and the loan
 * page's "Create a new category" (EXF-482, loan manage).
 */
export async function checkNewCategory(
  db: Db,
  budgetId: string,
  nc: NewCategoryInput,
): Promise<NonNullable<LoanSpec["newCategory"]>> {
  if (nc.group_id !== undefined) {
    const group = await groupsRepo.findActive(db, budgetId, nc.group_id);
    if (!group || group.hidden || group.kind !== null) throw new LoanRefused(UNPAIRABLE_GROUP);
    if (await categoriesRepo.nameTaken(db, group.id, nc.name)) {
      throw new LoanRefused(CATEGORY_NAME_TAKEN);
    }
  } else if (nc.new_group_name !== undefined) {
    if (await groupsRepo.nameTaken(db, budgetId, nc.new_group_name)) {
      throw new LoanRefused(GROUP_NAME_TAKEN);
    }
  }
  return {
    name: nc.name,
    groupId: nc.group_id ?? null,
    newGroupName: nc.new_group_name ?? null,
  };
}

/** The loan fields as stored, and the pairing checked with constant reads (the batch guards repeat the checks). */
async function resolveLoan(
  db: Db,
  budgetId: string,
  v: ReturnType<typeof AccountCreateRequest.parse>,
): Promise<LoanSpec> {
  const spec: LoanSpec = {
    interestRate: canonicalInterestRate(v.interest_rate ?? "0"),
    minimumPayment: v.minimum_payment ?? 0,
    escrowAmount: v.escrow_amount ?? 0,
    pairedCategoryId: null,
    newCategory: null,
  };
  if (v.paired_category_id !== undefined) {
    const cat = await categoriesRepo.findActive(db, budgetId, v.paired_category_id);
    const group = cat ? await groupsRepo.findActive(db, budgetId, cat.groupId) : undefined;
    if (!cat || !group || cat.hidden || cat.kind !== null || group.hidden || group.kind !== null) {
      throw new LoanRefused(UNPAIRABLE_CATEGORY);
    }
    spec.pairedCategoryId = cat.id;
  }
  if (v.new_category) spec.newCategory = await checkNewCategory(db, budgetId, v.new_category);
  return spec;
}

/**
 * The guarded create behind Add Account and "add from bank": the account, the system payee when missing
 * and the Starting Balance, each with its change_log row, in one batch. A loan with a new paired category
 * also creates that category (and its group) first, in the same batch.
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
    /** The loan's recorded fields and pairing (loan types from Add Unlinked Account only). */
    loan?: LoanSpec;
    /** The bank connection's state, for the answer and the log row (the row itself does not hold it). */
    link?: {
      connectionStatus: string;
      connectionSyncedAt: string | null;
      connectionErrorCode?: string | null;
    };
  },
): Promise<{ account: Account; starting_balance: Transaction }> {
  const db = getDb(env);
  const { amount, loan } = spec;
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
      linkMissingSince: null,
      interestRate: loan?.interestRate ?? null,
      minimumPayment: loan?.minimumPayment ?? null,
      escrowAmount: loan?.escrowAmount ?? null,
      pairedCategoryId: loan?.pairedCategoryId ?? null,
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
    const g1 = accountsRepo.newAccountGuard(
      db,
      budgetId,
      row.sortOrder,
      row.name,
      spec.bankAccountId,
    );
    const g1ok = sql`exists ${g1}`;
    const pairing = loan?.newCategory
      ? await pairingStmts(db, actor, budgetId, loan.newCategory, g1ok, now)
      : null;
    if (pairing) row.pairedCategoryId = pairing.categoryId;
    const accountGuard = whenQuery(
      db,
      loan?.pairedCategoryId
        ? sql`${g1ok} and ${accountsRepo.pairableCategory(budgetId, loan.pairedCategoryId)}`
        : pairing
          ? sql`${g1ok} and exists (select 1 from categories where id = ${pairing.categoryId})`
          : g1ok,
    );
    const account = accountToApi(
      { ...row, ...spec.link },
      { cleared: amount, uncleared: 0, canDelete: true },
    );
    const g2 = accountsRepo.existsStmt(db, row.id);
    const pre = pairing?.stmts ?? [];
    const results = await db.batch([
      ...pre,
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
        accountGuard,
      ),
      accountsRepo.insertIfStmt(db, row, accountGuard),
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
    ] as unknown as [BatchItem, ...BatchItem[]]);
    if ((results[pre.length + 1]?.meta.changes ?? 0) > 0) {
      const linked = await payeesRepo.findSystem(db, budgetId, "starting_balance");
      return {
        account,
        starting_balance: transactionToApi({ ...tx, payeeId: linked?.id ?? null }),
      };
    }
    if (await accountsRepo.nameTaken(db, budgetId, spec.name)) throw new NameTaken();
    if (loan) await explainLoanRefusal(db, budgetId, loan);
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

/**
 * The new paired category's statements, group first when it is new: each with its change_log row (log first),
 * guarded on the account guard `g1` so the group, the category and the account are written together or not at
 * all. The category's guard also needs its group, which a failed group guard leaves missing.
 */
export async function pairingStmts(
  db: Db,
  actor: string,
  budgetId: string,
  nc: NonNullable<LoanSpec["newCategory"]>,
  g1: SQL,
  now: string,
) {
  const stmts: BatchItem[] = [];
  let groupId = nc.groupId;
  let categorySort = 0;
  if (groupId === null) {
    const group: groupsRepo.CategoryGroupRow = {
      id: crypto.randomUUID(),
      budgetId,
      name: nc.newGroupName ?? "",
      sortOrder: (await groupsRepo.maxSort(db, budgetId)) + 1,
      hidden: false,
      collapsed: false,
      kind: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    groupId = group.id;
    const guard = sql`${g1} and ${groupsRepo.nameFree(budgetId, group.name)} and exists ${groupsRepo.sortIsNext(db, budgetId, group.sortOrder)}`;
    stmts.push(
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "create",
          entityType: "category_group",
          entityId: group.id,
          before: null,
          after: groupToApi(group),
        },
        whenQuery(db, guard),
      ),
      groupsRepo.insertIfStmt(db, group, guard),
    );
  } else {
    categorySort = (await categoriesRepo.maxSort(db, groupId)) + 1;
  }
  const category: categoriesRepo.CategoryRow = {
    id: crypto.randomUUID(),
    budgetId,
    groupId,
    name: nc.name,
    sortOrder: categorySort,
    hidden: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    note: null,
    kind: null,
    accountId: null,
  };
  const guard = sql`${g1} and ${accountsRepo.pairableGroup(budgetId, groupId)} and ${categoriesRepo.nameFree(groupId, category.name)} and exists ${categoriesRepo.sortIsNext(db, groupId, categorySort)}`;
  stmts.push(
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor,
        action: "create",
        entityType: "category",
        entityId: category.id,
        before: null,
        after: categoryToApi(category),
      },
      whenQuery(db, guard),
    ),
    categoriesRepo.insertIfStmt(db, category, guard),
  );
  return { stmts, categoryId: category.id };
}

/** After a batch that wrote nothing: say which loan rule was lost to a concurrent change (else the caller retries). */
async function explainLoanRefusal(db: Db, budgetId: string, loan: LoanSpec): Promise<void> {
  if (loan.pairedCategoryId) {
    const cat = await categoriesRepo.findActive(db, budgetId, loan.pairedCategoryId);
    const group = cat ? await groupsRepo.findActive(db, budgetId, cat.groupId) : undefined;
    if (!cat || !group || cat.hidden || group.hidden) throw new LoanRefused(UNPAIRABLE_CATEGORY);
  }
  if (loan.newCategory) await explainNewCategoryRefusal(db, budgetId, loan.newCategory);
}

/** After a batch that wrote nothing: say which new-category rule was lost to a concurrent change. */
export async function explainNewCategoryRefusal(
  db: Db,
  budgetId: string,
  nc: NonNullable<LoanSpec["newCategory"]>,
): Promise<void> {
  if (nc.groupId !== null) {
    const group = await groupsRepo.findActive(db, budgetId, nc.groupId);
    if (!group || group.hidden || group.kind !== null) throw new LoanRefused(UNPAIRABLE_GROUP);
    if (await categoriesRepo.nameTaken(db, group.id, nc.name)) {
      throw new LoanRefused(CATEGORY_NAME_TAKEN);
    }
  } else if (
    nc.newGroupName !== null &&
    (await groupsRepo.nameTaken(db, budgetId, nc.newGroupName))
  ) {
    throw new LoanRefused(GROUP_NAME_TAKEN);
  }
}
