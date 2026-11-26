import {
  ACCOUNT_TYPES,
  isOnBudget,
  startingBalanceFeedsReadyToAssign,
} from "@budget/core/account-types";
import type { EngineActivity } from "@budget/core/budget-engine";
import {
  estimatedTotal,
  type LoanMonthIn,
  type LoanTerms,
  runLoan,
} from "@budget/core/loan-engine";
import type { PayeeSystem } from "@budget/schema/payees";
import type { SearchToken } from "@budget/schema/transaction-search";
import { transferPayeeName } from "@budget/schema/transfers";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  not,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";
import { insertSelect } from "./insert-select";
import { balanceGroupsQuery, balancesFromGroups } from "./loan-activity";

type Sel = typeof transactions.$inferSelect;
type LinkCols =
  | "transferAccountId"
  | "transferTransactionId"
  | "parentTransactionId"
  | "splitIndex"
  | "importId"
  | "source"
  | "importedPayee"
  | "bankDescription"
  | "importDate"
  | "importAmount"
  | "importPayeeName"
  | "flagColor"
  | "importMemo"
  | "matchEntryAmount"
  | "pendingTransactionId"
  | "status";
/** The link columns are optional so a plain row can be built without them (they insert as null). */
export type TransactionRow = Omit<Sel, LinkCols> & Partial<Pick<Sel, LinkCols>>;

export function insertStmt(db: Db, row: TransactionRow) {
  return db.insert(transactions).values(row);
}

/** Inserts the row only while `guard` holds. Column order is the table's. */
export function insertIfStmt(db: Db, row: TransactionRow, guard: SQLWrapper, payeeIdSql?: SQL) {
  const r = row;
  const payeeId = payeeIdSql ?? sql`${r.payeeId}`;
  return insertSelect(
    db,
    transactions,
    {
      id: r.id,
      budgetId: r.budgetId,
      accountId: r.accountId,
      date: r.date,
      payeeName: r.payeeName,
      categoryId: r.categoryId,
      inflowToReadyToAssign: r.inflowToReadyToAssign ? 1 : 0,
      memo: r.memo,
      amount: r.amount,
      cleared: r.cleared,
      approved: r.approved ? 1 : 0,
      createdAt: r.createdAt,
      deletedAt: r.deletedAt,
      updatedAt: r.updatedAt,
      payeeId,
      transferAccountId: r.transferAccountId ?? null,
      transferTransactionId: r.transferTransactionId ?? null,
      parentTransactionId: r.parentTransactionId ?? null,
      splitIndex: r.splitIndex ?? null,
      importId: r.importId ?? null,
      source: r.source ?? null,
      importedPayee: r.importedPayee ?? null,
      bankDescription: r.bankDescription ?? null,
      importDate: r.importDate ?? null,
      importAmount: r.importAmount ?? null,
      importPayeeName: r.importPayeeName ?? null,
      importMemo: r.importMemo ?? null,
      flagColor: r.flagColor ?? null,
      pendingTransactionId: r.pendingTransactionId ?? null,
      status: r.status ?? null,
    },
    sql`where exists ${guard}`,
  );
}

/** A row that counts in an account's balance: not deleted and not a split line. Usable in `where()` and in raw `sql`. */
export function countsInBalance(): SQL {
  return and(isNull(transactions.deletedAt), isNull(transactions.parentTransactionId)) as SQL;
}

/**
 * Needs a category: an on-plan account, no category, not Ready to Assign, not a split parent, not a transfer to
 * an on-plan account, not a Starting Balance. Raw SQL over `transactions`, usable in `where()`.
 */
export function needsCategory(): SQL {
  const t = transactions;
  return sql`(
    ${t.categoryId} is null and ${t.inflowToReadyToAssign} = 0
    and exists (select 1 from accounts na where na.id = ${t.accountId} and na.on_budget = 1)
    and not exists (select 1 from transactions nl where nl.parent_transaction_id = ${t.id} and nl.deleted_at is null)
    and not (${t.transferAccountId} is not null
      and exists (select 1 from accounts nt where nt.id = ${t.transferAccountId} and nt.on_budget = 1))
    and coalesce((select np.system from payees np where np.id = ${t.payeeId}), '') <> 'starting_balance')`;
}

/** A transaction that needs the user: it is unapproved, or it needs a category. */
export function needsAttention(): SQL {
  return sql`(${transactions.approved} = 0 or ${needsCategory()})`;
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The columns of one row in a search condition: the listed row (`"transactions"`) or one of its lines (`l`). */
const rowCols = (prefix: string) => {
  const c = (name: string) => sql.raw(`${prefix}.${name}`);
  return {
    amount: c("amount"),
    memo: c("memo"),
    payee: sql`coalesce(
      case when ${c("transfer_account_id")} is not null
        then (select 'Transfer : ' || x.name from accounts x where x.id = ${c("transfer_account_id")}) end,
      (select p.name from payees p where p.id = ${c("payee_id")}),
      ${c("payee_name")})`,
    category: sql`case when ${c("inflow_to_ready_to_assign")} = 1 then 'Ready to Assign'
      else (select k.name from categories k where k.id = ${c("category_id")}) end`,
  };
};

/** One search token on a row; `line` is set for a split line, whose payee falls back to the parent's. */
function tokenSql(token: SearchToken, line: boolean): SQL {
  const parent = rowCols('"transactions"');
  const row = line ? rowCols("l") : parent;
  const payee = line ? sql`coalesce(${row.payee}, ${parent.payee})` : row.payee;
  const account = sql`(select ac.name from accounts ac where ac.id = ${transactions.accountId})`;
  const t = transactions;
  switch (token.type) {
    case "text": {
      const field = {
        payee,
        category: row.category,
        memo: row.memo,
        account,
        any: sql`(coalesce(${payee}, '') || char(31) || coalesce(${row.category}, '') || char(31) || coalesce(${row.memo}, '') || char(31) || coalesce(${account}, ''))`,
      }[token.field];
      return sql`lower(coalesce(${field}, '')) like lower(${`%${escapeLike(token.value)}%`}) escape '\\'`;
    }
    case "amount": {
      const op = { eq: "=", gte: ">=", lte: "<=" }[token.op];
      return token.side === "outflow"
        ? sql`(${row.amount} < 0 and -${row.amount} ${sql.raw(op)} ${token.milliunits})`
        : sql`(${row.amount} > 0 and ${row.amount} ${sql.raw(op)} ${token.milliunits})`;
    }
    case "flag":
      return token.color ? sql`${t.flagColor} = ${token.color}` : sql`${t.flagColor} is null`;
    case "date": {
      const op = { on: "=", before: "<=", after: ">=" }[token.op];
      return sql`${t.date} ${sql.raw(op)} ${token.date}`;
    }
    case "income":
      return sql`(${t.inflowToReadyToAssign} = 1 and ${t.amount} > 0 and substr(${t.date}, 1, 7) = ${token.month.slice(0, 7)})`;
    case "is":
      switch (token.value) {
        case "Uncleared":
          return sql`${t.cleared} = 'uncleared'`;
        case "Cleared":
          return sql`${t.cleared} = 'cleared'`;
        case "Reconciled":
          return sql`${t.cleared} = 'reconciled'`;
        case "Unreconciled":
          return sql`${t.cleared} <> 'reconciled'`;
        case "Cleared or Reconciled":
          return sql`${t.cleared} in ('cleared', 'reconciled')`;
        case "Matched":
          return sql`(${t.importId} is not null and ${t.source} is null)`;
        case "Approved":
          return sql`${t.approved} = 1`;
        case "Unapproved":
          return sql`${t.approved} = 0`;
        case "Needs Category":
          return needsCategory();
        case "Unapproved or Needs Category":
          return needsAttention();
      }
  }
}

/**
 * The search tokens as one condition on the listed (parent) row: every token holds on the row, or on one of its
 * live split lines (the row's own account, date, flag and status still apply). All values are bound parameters,
 * and it adds no statement.
 */
export function searchCondition(tokens: readonly SearchToken[]): SQL {
  const onRow = sql.join(
    tokens.map((k) => tokenSql(k, false)),
    sql` and `,
  );
  const onLine = sql.join(
    tokens.map((k) => tokenSql(k, true)),
    sql` and `,
  );
  return sql`((${onRow}) or exists (select 1 from transactions l
    where l.parent_transaction_id = ${transactions.id} and l.deleted_at is null and (${onLine})))`;
}

export type AttentionCounts = { unapproved: number; attention: number };

/** Per account: how many live rows are unapproved, and how many need approval or a category. A new query: no sum of amounts changes. */
export async function attentionCountsByAccount(
  db: Db,
  budgetId: string,
  accountId?: string,
): Promise<Map<string, AttentionCounts>> {
  const conds = [eq(transactions.budgetId, budgetId), countsInBalance()];
  if (accountId) conds.push(eq(transactions.accountId, accountId));
  const rows = await db
    .select({
      accountId: transactions.accountId,
      unapproved: sql<number>`coalesce(sum(case when ${transactions.approved} = 0 then 1 else 0 end), 0)`,
      attention: sql<number>`coalesce(sum(case when ${needsAttention()} then 1 else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(...conds))
    .groupBy(transactions.accountId);
  return new Map(
    rows.map((r) => [r.accountId, { unapproved: r.unapproved, attention: r.attention }]),
  );
}

const estimatedOf = (terms: LoanTerms, months: LoanMonthIn[]) =>
  estimatedTotal(runLoan(terms, months));

/**
 * Per account: the sum of cleared (and reconciled) and of uncleared active transactions, plus a loan's computed
 * interest and escrow (`estimated`, counted as cleared: docs/loan-engine-design.md). One statement, one D1 call.
 */
export async function balancesByAccount(
  db: Db,
  budgetId: string,
  accountId?: string,
): Promise<Map<string, { cleared: number; uncleared: number; estimated: number }>> {
  const rows = await balanceGroupsQuery(db, budgetId, { accountId });
  const out = balancesFromGroups(rows, estimatedOf);
  for (const b of out.values()) b.cleared += b.estimated;
  return out;
}

// A new credit account's Starting Balance is on-plan with no category and no Ready to Assign flag, which the
// engine would count as uncategorized activity. Left out until EXF-532 (payment categories) replaces this.
const UNCOUNTED_STARTING_TYPES = ACCOUNT_TYPES.filter(
  (t) => isOnBudget(t) && !startingBalanceFeedsReadyToAssign(t),
);

/**
 * Active transactions on active accounts dated before `before`, summed per month, category, inflow flag and
 * account (on_budget, type). `date` is the month's first day, which the engine reads like any date.
 */
export async function activityByMonth(
  db: Db,
  budgetId: string,
  before: string,
): Promise<EngineActivity[]> {
  const ym = sql<string>`substr(${transactions.date}, 1, 7)`;
  const rows = await db
    .select({
      ym,
      amount: sql<number>`sum(${transactions.amount})`,
      categoryId: transactions.categoryId,
      inflow: transactions.inflowToReadyToAssign,
      onBudget: accounts.onBudget,
      accountType: accounts.type,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), isNull(accounts.deletedAt)))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .leftJoin(ta, eq(ta.id, transactions.transferAccountId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        isNull(transactions.deletedAt),
        lt(transactions.date, before),
        // A transfer between two on-plan accounts counts nowhere: no category, not uncategorized, no Ready to Assign.
        sql`not (${transactions.transferAccountId} is not null and ${accounts.onBudget} = 1 and coalesce(${ta.onBudget}, 0) = 1)`,
        // A split parent counts nothing: its lines (rows of their own) count in their categories.
        sql`not exists (select 1 from transactions l where l.parent_transaction_id = ${transactions.id} and l.deleted_at is null)`,
        not(
          and(
            inArray(accounts.type, UNCOUNTED_STARTING_TYPES),
            // null-safe: a payee-less row must not make the whole NOT(...) NULL and drop out of the WHERE
            sql`coalesce(${payees.system}, '') = 'starting_balance'`,
            isNull(transactions.categoryId),
            eq(transactions.inflowToReadyToAssign, false),
          ) as SQLWrapper,
        ),
      ),
    )
    .groupBy(
      ym,
      transactions.categoryId,
      transactions.inflowToReadyToAssign,
      accounts.onBudget,
      accounts.type,
    );
  return rows.map((r) => ({
    date: `${r.ym}-01`,
    amount: r.amount,
    categoryId: r.categoryId,
    inflowToReadyToAssign: r.inflow,
    onBudget: r.onBudget,
    accountType: r.accountType,
  }));
}

/** Cleared and uncleared sums over every open, non-deleted account of the plan, loans' computed charges included. */
export async function openAccountsBalances(
  db: Db,
  budgetId: string,
): Promise<{ cleared: number; uncleared: number; estimated: number }> {
  const rows = await balanceGroupsQuery(db, budgetId, { open: true });
  let cleared = 0;
  let uncleared = 0;
  let estimated = 0;
  for (const b of balancesFromGroups(rows, estimatedOf).values()) {
    cleared += b.cleared + b.estimated;
    uncleared += b.uncleared;
    estimated += b.estimated;
  }
  return { cleared, uncleared, estimated };
}

export type TransactionDetailRow = TransactionRow & {
  categoryName: string | null;
  groupName: string | null;
  payeeSystem: PayeeSystem | null;
  transferAccountName: string | null;
  hasImage?: boolean;
  runningBalance?: number;
};

/** True when a live receipt image is attached; labelled so it never clashes with another column. */
const hasImageSql =
  sql<number>`exists (select 1 from transaction_images ti where ti.transaction_id = ${transactions.id} and ti.deleted_at is null)`.as(
    "has_image",
  );

const ta = alias(accounts, "ta");

// Soft-deleted categories and groups still join, so an old row keeps its label.
const detailSelect = (db: Db) =>
  db
    .select({
      t: transactions,
      categoryName: categories.name,
      groupName: categoryGroups.name,
      payeeName: payees.name,
      payeeSystem: payees.system,
      transferAccountName: ta.name,
      hasImage: hasImageSql,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .leftJoin(ta, eq(ta.id, transactions.transferAccountId));

const toDetail = (r: {
  t: Sel;
  categoryName: string | null;
  groupName: string | null;
  payeeName: string | null;
  payeeSystem: PayeeSystem | null;
  transferAccountName: string | null;
  hasImage: number;
}): TransactionDetailRow => ({
  ...r.t,
  // A transfer's payee is the other account, by its current name.
  payeeName: r.transferAccountName
    ? transferPayeeName(r.transferAccountName)
    : (r.payeeName ?? r.t.payeeName),
  categoryName: r.categoryName,
  groupName: r.groupName,
  payeeSystem: r.payeeSystem,
  transferAccountName: r.transferAccountName,
  hasImage: Boolean(r.hasImage),
});

export async function findDetail(
  db: Db,
  budgetId: string,
  id: string,
): Promise<TransactionDetailRow | undefined> {
  const [row] = await detailSelect(db)
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.budgetId, budgetId),
        isNull(transactions.deletedAt),
        isNull(transactions.parentTransactionId),
      ),
    )
    .limit(1);
  return row ? toDetail(row) : undefined;
}

/** Several rows at once (a missing or deleted id is absent from the map); one JSON parameter keeps it under D1's bound-parameter limit. */
export async function findDetailMany(
  db: Db,
  budgetId: string,
  ids: readonly string[],
): Promise<Map<string, TransactionDetailRow>> {
  if (ids.length === 0) return new Map();
  const rows = await detailSelect(db).where(
    and(
      sql`${transactions.id} in (select value from json_each(${JSON.stringify(ids)}))`,
      eq(transactions.budgetId, budgetId),
      isNull(transactions.deletedAt),
      isNull(transactions.parentTransactionId),
    ),
  );
  return new Map(rows.map((r) => [r.t.id, toDetail(r)]));
}

/** The account's non-deleted transactions dated `sinceDate` or later, in no particular order. */
export async function listDetailForAccount(
  db: Db,
  budgetId: string,
  accountId: string,
  sinceDate?: string,
  needs?: "approval_or_category",
  opts: { runningBalance?: boolean; search?: readonly SearchToken[] } = {},
): Promise<TransactionDetailRow[]> {
  const conds = [
    eq(transactions.budgetId, budgetId),
    eq(transactions.accountId, accountId),
    isNull(transactions.deletedAt),
    isNull(transactions.parentTransactionId),
  ];
  if (sinceDate) conds.push(gte(transactions.date, sinceDate));
  if (needs) conds.push(needsAttention());
  if (opts.search?.length) conds.push(searchCondition(opts.search));
  if (!opts.runningBalance) return (await detailSelect(db).where(and(...conds))).map(toDetail);
  // Every live row of the account counts, whatever the filters above leave out: the window runs in its own
  // subquery. The register's order is date desc, amount asc, created_at, id, so the balance runs the reverse.
  const rb = db
    .select({
      id: transactions.id,
      balance:
        sql<number>`sum(${transactions.amount}) over (order by ${transactions.date} asc, ${transactions.amount} desc, ${transactions.createdAt} desc, ${transactions.id} desc rows between unbounded preceding and current row)`.as(
          "running_balance",
        ),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        eq(transactions.accountId, accountId),
        countsInBalance(),
      ),
    )
    .as("rb");
  const rows = await db
    .select({
      t: transactions,
      categoryName: categories.name,
      groupName: categoryGroups.name,
      payeeName: payees.name,
      payeeSystem: payees.system,
      transferAccountName: ta.name,
      hasImage: hasImageSql,
      runningBalance: rb.balance,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .leftJoin(ta, eq(ta.id, transactions.transferAccountId))
    .leftJoin(rb, eq(rb.id, transactions.id))
    .where(and(...conds));
  return rows.map((r) => ({ ...toDetail(r), runningBalance: r.runningBalance ?? undefined }));
}

export type PlanDetailRow = TransactionDetailRow & { accountName: string };

/** Non-deleted transactions of every non-deleted account (closed included) dated `sinceDate` or later. */
export async function listDetailForPlan(
  db: Db,
  budgetId: string,
  sinceDate?: string,
  needs?: "approval_or_category",
  opts: { search?: readonly SearchToken[] } = {},
): Promise<PlanDetailRow[]> {
  const conds = [
    eq(transactions.budgetId, budgetId),
    isNull(transactions.deletedAt),
    isNull(transactions.parentTransactionId),
  ];
  if (sinceDate) conds.push(gte(transactions.date, sinceDate));
  if (needs) conds.push(needsAttention());
  if (opts.search?.length) conds.push(searchCondition(opts.search));
  const rows = await db
    .select({
      t: transactions,
      categoryName: categories.name,
      groupName: categoryGroups.name,
      accountName: accounts.name,
      payeeName: payees.name,
      payeeSystem: payees.system,
      transferAccountName: ta.name,
      hasImage: hasImageSql,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), isNull(accounts.deletedAt)))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .leftJoin(ta, eq(ta.id, transactions.transferAccountId))
    .where(and(...conds));
  return rows.map((r) => ({ ...toDetail(r), accountName: r.accountName }));
}

const same = (col: SQLWrapper, v: string | number | boolean | null) =>
  sql`${col} is ${typeof v === "boolean" ? (v ? 1 : 0) : v}`;

function holdsCondition(before: TransactionRow) {
  const t = transactions;
  return and(
    eq(t.id, before.id),
    isNull(t.deletedAt),
    same(t.accountId, before.accountId),
    same(t.date, before.date),
    same(t.payeeId, before.payeeId),
    same(t.categoryId, before.categoryId),
    same(t.inflowToReadyToAssign, before.inflowToReadyToAssign),
    same(t.memo, before.memo),
    same(t.amount, before.amount),
    same(t.cleared, before.cleared),
    same(t.approved, before.approved),
    same(t.transferAccountId, before.transferAccountId ?? null),
    same(t.transferTransactionId, before.transferTransactionId ?? null),
  ) as SQL;
}

/** Like `holds`, and the row's `updated_at` is unchanged too: any write since the read makes it fail. */
export function holdsAt(db: Db, before: TransactionRow) {
  return db
    .select({ x: sql`1` })
    .from(transactions)
    .where(and(holdsCondition(before), same(transactions.updatedAt, before.updatedAt)) as SQL);
}

/** One guard that holds while every given guard does. */
export function allHold(guards: SQLWrapper[]): SQLWrapper {
  return sql`(select 1 where ${sql.join(
    guards.map((g) => sql`exists ${g}`),
    sql` and `,
  )})`;
}

/**
 * Holds while every `{id, updatedAt}` still matches a live row (ids deduplicated first).
 * The snapshot rides one JSON parameter, so it stays under D1's bound-parameter limit.
 */
export function unchangedSince(db: Db, snap: readonly { id: string; updatedAt: string }[]) {
  const uniq = [...new Map(snap.map((s) => [s.id, s.updatedAt])).entries()].map(([id, u]) => ({
    id,
    u,
  }));
  return sql`(select 1 where (select count(*) from transactions t, json_each(${JSON.stringify(uniq)}) j where t.id = json_extract(j.value,'$.id') and t.updated_at = json_extract(j.value,'$.u') and t.deleted_at is null) = ${uniq.length})`;
}

/** A `SELECT 1` that holds when the row was written at `at` (its `updated_at`). */
export function writtenAt(db: Db, id: string, at: string) {
  return db
    .select({ x: sql`1` })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.updatedAt, at)));
}

/** A `SELECT 1` that holds while the row still has every value of `before` and is not deleted. */
export function holds(db: Db, before: TransactionRow) {
  return db.select({ x: sql`1` }).from(transactions).where(holdsCondition(before));
}

/** The columns a write may set on a row. */
export type TxSet = Partial<
  Pick<
    Sel,
    | "accountId"
    | "date"
    | "payeeName"
    | "categoryId"
    | "inflowToReadyToAssign"
    | "memo"
    | "amount"
    | "cleared"
    | "approved"
    | "transferAccountId"
    | "transferTransactionId"
    | "updatedAt"
    | "deletedAt"
    | "importId"
    | "source"
    | "importedPayee"
    | "bankDescription"
    | "importDate"
    | "importAmount"
    | "importPayeeName"
    | "importMemo"
    | "flagColor"
    | "matchEntryAmount"
    | "status"
    | "pendingTransactionId"
  >
> & { payeeId?: string | null | SQL };

/** Sets the row's columns only while `guard` holds. */
export function updateIfStmt(db: Db, id: string, set: TxSet, guard: SQLWrapper) {
  return db
    .update(transactions)
    .set(set)
    .where(and(eq(transactions.id, id), sql`exists ${guard}`));
}

export function updateIfHoldsStmt(
  db: Db,
  before: TransactionRow,
  after: TransactionRow,
  updatedAt: string,
) {
  return updateIfStmt(
    db,
    before.id,
    {
      accountId: after.accountId,
      date: after.date,
      payeeName: after.payeeName,
      payeeId: after.payeeId,
      categoryId: after.categoryId,
      inflowToReadyToAssign: after.inflowToReadyToAssign,
      memo: after.memo,
      amount: after.amount,
      cleared: after.cleared,
      approved: after.approved,
      // Only a write that changes the flag sets it, so an edit never overwrites a concurrent flag.
      ...((after.flagColor ?? null) !== (before.flagColor ?? null)
        ? { flagColor: after.flagColor ?? null }
        : {}),
      updatedAt,
    },
    holds(db, before),
  );
}

export function softDeleteIfStmt(db: Db, id: string, at: string, guard: SQLWrapper) {
  return updateIfStmt(db, id, { deletedAt: at, updatedAt: at }, guard);
}

/** Soft-deletes the live lines of a split parent while `guard` holds. */
export function softDeleteLinesIfStmt(db: Db, parentId: string, at: string, guard: SQLWrapper) {
  return db
    .update(transactions)
    .set({ deletedAt: at, updatedAt: at })
    .where(
      and(
        eq(transactions.parentTransactionId, parentId),
        isNull(transactions.deletedAt),
        sql`exists ${guard}`,
      ),
    );
}

/** Keeps the live lines' account, date, cleared and approved in step with their parent. */
export function syncLinesIfStmt(
  db: Db,
  parentId: string,
  set: Pick<Sel, "accountId" | "date" | "cleared" | "approved" | "updatedAt">,
  guard: SQLWrapper,
) {
  return db
    .update(transactions)
    .set(set)
    .where(
      and(
        eq(transactions.parentTransactionId, parentId),
        isNull(transactions.deletedAt),
        sql`exists ${guard}`,
      ),
    );
}

export type LineRow = TransactionRow & {
  categoryName: string | null;
  groupName: string | null;
};

/** The live lines of split parents, by parent then `split_index`. */
export async function listLines(
  db: Db,
  budgetId: string,
  filter: {
    accountId?: string;
    parentId?: string;
    parentIds?: readonly string[];
    sinceDate?: string;
  },
): Promise<LineRow[]> {
  if (filter.parentIds && filter.parentIds.length === 0) return [];
  const conds = [
    eq(transactions.budgetId, budgetId),
    isNull(transactions.deletedAt),
    sql`${transactions.parentTransactionId} is not null`,
  ];
  if (filter.accountId) conds.push(eq(transactions.accountId, filter.accountId));
  if (filter.parentId) conds.push(eq(transactions.parentTransactionId, filter.parentId));
  if (filter.parentIds)
    conds.push(
      sql`${transactions.parentTransactionId} in (select value from json_each(${JSON.stringify(filter.parentIds)}))`,
    );
  if (filter.sinceDate) conds.push(gte(transactions.date, filter.sinceDate));
  const rows = await db
    .select({
      t: transactions,
      categoryName: categories.name,
      groupName: categoryGroups.name,
      payeeName: payees.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .leftJoin(payees, eq(payees.id, transactions.payeeId))
    .where(and(...conds))
    .orderBy(transactions.parentTransactionId, transactions.splitIndex);
  return rows.map((r) => ({
    ...r.t,
    payeeName: r.payeeName ?? r.t.payeeName,
    categoryName: r.categoryName,
    groupName: r.groupName,
  }));
}

/** The names of the active categories (in active groups) among `ids`, in one query: id → category and group name. */
export async function categoryNamesMany(
  db: Db,
  budgetId: string,
  ids: readonly string[],
): Promise<
  Map<
    string,
    { categoryName: string; groupName: string; kind: string | null; accountId: string | null }
  >
> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: categories.id,
      categoryName: categories.name,
      groupName: categoryGroups.name,
      kind: categories.kind,
      accountId: categories.accountId,
    })
    .from(categories)
    .innerJoin(
      categoryGroups,
      and(eq(categoryGroups.id, categories.groupId), isNull(categoryGroups.deletedAt)),
    )
    .where(
      and(
        eq(categories.budgetId, budgetId),
        isNull(categories.deletedAt),
        sql`${categories.id} in (select value from json_each(${JSON.stringify(ids)}))`,
      ),
    );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        categoryName: r.categoryName,
        groupName: r.groupName,
        kind: r.kind,
        accountId: r.accountId,
      },
    ]),
  );
}

/** The name of a category's group (deleted or not), for the change_log copy of a row. */
export async function groupNameOfCategory(db: Db, categoryId: string): Promise<string | null> {
  const [r] = await db
    .select({ name: categoryGroups.name })
    .from(categories)
    .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(eq(categories.id, categoryId))
    .limit(1);
  return r?.name ?? null;
}

/** Points the live transactions of `fromIds` at another payee (or none), with the fallback name, while `guard` holds. */
export function movePayeeStmt(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
  toId: string | null,
  now: string,
  guard: SQL,
) {
  return db
    .update(transactions)
    .set({
      payeeId: toId,
      payeeName: toId === null ? null : sql`(select name from payees where id = ${toId})`,
      updatedAt: now,
    })
    .where(
      sql`${transactions.budgetId} = ${budgetId} and ${transactions.payeeId} in (select value from json_each(${JSON.stringify(fromIds)})) and ${transactions.deletedAt} is null and ${guard}`,
    );
}
