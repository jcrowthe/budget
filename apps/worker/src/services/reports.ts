import { displayGroup, sidebarSections } from "@budget/core/account-types";
import {
  computeIncomeExpense,
  filterIncome,
  incomeExpenseCsv,
  NO_PAYEE_ID,
} from "@budget/schema/income-expense";
import { computeNetWorth, netWorthCsv } from "@budget/schema/net-worth";
import {
  addMonthsTo,
  monthOfDate,
  planFirstMonth,
  type RangeFacts,
  resolveRange,
} from "@budget/schema/report-range";
import type {
  IncomeExpense,
  IncomeExpenseQuery,
  NetWorth,
  NetWorthQuery,
  ReportRange,
  ReportRangeQuery,
  ReportTransaction,
  ReportTransactionsQuery,
  SpendingBreakdown,
  SpendingBreakdownQuery,
  SpendingTrends,
  SpendingTrendsQuery,
} from "@budget/schema/reports";
import {
  breakdownCsv,
  computeBreakdown,
  filterRows,
  newestFirst,
  type SpendingRow,
  transactionsCsv,
} from "@budget/schema/spending-breakdown";
import { computeTrends } from "@budget/schema/spending-trends";
import { storeZip, utf8 } from "@budget/schema/zip";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as repo from "../repositories/reports";

const utcToday = () => new Date().toISOString().slice(0, 10);

async function requirePlan(db: Db, budgetId: string) {
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
}

export async function rangeFacts(db: Db, budgetId: string, today?: string): Promise<RangeFacts> {
  const current = monthOfDate(today ?? utcToday());
  const first = planFirstMonth(await repo.earliestTransactionMonth(db, budgetId), current);
  return { first_month: first, current_month: current };
}

export async function getReportRange(
  env: Env,
  budgetId: string,
  q: ReportRangeQuery,
): Promise<ReportRange> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const facts = await rangeFacts(db, budgetId, q.today);
  const span = resolveRange(
    q.preset,
    q.preset === "custom"
      ? { start_month: q.start_month ?? null, end_month: q.end_month ?? null }
      : null,
    facts,
  );
  return { ...facts, ...span };
}

export async function getNetWorth(env: Env, budgetId: string, q: NetWorthQuery): Promise<NetWorth> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const facts = await rangeFacts(db, budgetId, q.today);
  const span =
    q.start_month && q.end_month
      ? { start_month: q.start_month, end_month: q.end_month }
      : resolveRange("all_dates", null, facts);
  const rows = await repo.reportAccounts(db, budgetId);
  const sections = sidebarSections(
    rows.map((a) => ({
      id: a.id,
      name: a.name,
      starred: a.starred,
      closed: a.closed,
      group: displayGroup(a.type, a.closed),
      balance: 0,
    })),
  );
  const excluded = new Set(q.excluded_account_ids);
  const accounts = sections
    .filter((s) => s.name !== "starred")
    .flatMap((s) => s.rows)
    .filter((a) => !excluded.has(a.id))
    .map((a) => ({ id: a.id, name: a.name }));
  const sums = await repo.monthlySums(db, budgetId, addMonthsTo(span.end_month, 1));
  return computeNetWorth({ accounts, sums, first_month: facts.first_month, ...span });
}

export async function exportNetWorth(
  env: Env,
  budgetId: string,
  q: NetWorthQuery,
): Promise<{ filename: string; csv: string }> {
  const data = await getNetWorth(env, budgetId, q);
  return {
    filename: `budget-reflect-net-worth-${q.today ?? utcToday()}.csv`,
    csv: netWorthCsv(data),
  };
}

async function spendingSpan(db: Db, budgetId: string, q: SpendingBreakdownQuery) {
  if (q.start_month && q.end_month) {
    return { start_month: q.start_month, end_month: q.end_month };
  }
  return resolveRange("this_month", null, await rangeFacts(db, budgetId, q.today));
}

async function loadSpendingRows(
  db: Db,
  budgetId: string,
  span: { start_month: string; end_month: string },
  excluded: { categories: string[]; accounts: string[] },
): Promise<SpendingRow[]> {
  const rows = await repo.spendingRows(db, budgetId, {
    start: span.start_month,
    endBefore: addMonthsTo(span.end_month, 1),
  });
  return filterRows(rows, {
    excludedCategoryIds: excluded.categories,
    excludedAccountIds: excluded.accounts,
  });
}

export async function getSpendingBreakdown(
  env: Env,
  budgetId: string,
  q: SpendingBreakdownQuery,
): Promise<SpendingBreakdown> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const span = await spendingSpan(db, budgetId, q);
  let group: { id: string; name: string } | null = null;
  if (q.group_id) {
    const name = await repo.findCategoryOrGroup(db, budgetId, "group", q.group_id);
    if (name === null) throw new NotFound("Category group");
    group = { id: q.group_id, name };
  }
  const rows = await loadSpendingRows(db, budgetId, span, {
    categories: q.excluded_category_ids,
    accounts: q.excluded_account_ids,
  });
  return computeBreakdown({ rows, span, groupBy: q.group_by, group });
}

/** Last 3 Months from "today" unless both months are given. */
async function reportSpan(
  db: Db,
  budgetId: string,
  q: { start_month?: string; end_month?: string; today?: string },
) {
  if (q.start_month && q.end_month) {
    return { start_month: q.start_month, end_month: q.end_month };
  }
  return resolveRange("last_3_months", null, await rangeFacts(db, budgetId, q.today));
}

export async function getSpendingTrends(
  env: Env,
  budgetId: string,
  q: SpendingTrendsQuery,
): Promise<SpendingTrends> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const span = await reportSpan(db, budgetId, q);
  let group: { id: string; name: string } | null = null;
  if (q.group_id) {
    const name = await repo.findCategoryOrGroup(db, budgetId, "group", q.group_id);
    if (name === null) throw new NotFound("Category group");
    group = { id: q.group_id, name };
  }
  const rows = await loadSpendingRows(db, budgetId, span, {
    categories: q.excluded_category_ids,
    accounts: q.excluded_account_ids,
  });
  return computeTrends({ rows, span, group });
}

export async function exportSpendingTrends(
  env: Env,
  budgetId: string,
  q: SpendingTrendsQuery,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const today = q.today ?? utcToday();
  const span = await reportSpan(db, budgetId, q);
  const rows = await loadSpendingRows(db, budgetId, span, {
    categories: q.excluded_category_ids,
    accounts: q.excluded_account_ids,
  });
  const stem = `budget-reflect-spending-trends-${today}`;
  const bytes = storeZip(
    [
      { name: `${stem}.csv`, data: utf8(breakdownCsv(rows, span)) },
      {
        name: `${stem}-transactions.csv`,
        data: utf8(transactionsCsv([...rows].sort(newestFirst))),
      },
    ],
    today,
  );
  return { filename: `${stem}.zip`, bytes };
}

async function loadIncomeRows(
  db: Db,
  budgetId: string,
  span: { start_month: string; end_month: string },
  excludedAccounts: string[],
) {
  const rows = await repo.incomeRows(db, budgetId, {
    start: span.start_month,
    endBefore: addMonthsTo(span.end_month, 1),
  });
  return filterIncome(rows, excludedAccounts);
}

export async function getIncomeExpense(
  env: Env,
  budgetId: string,
  q: IncomeExpenseQuery,
): Promise<IncomeExpense> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const span = await reportSpan(db, budgetId, q);
  const spending = await loadSpendingRows(db, budgetId, span, {
    categories: q.excluded_category_ids,
    accounts: q.excluded_account_ids,
  });
  const income = await loadIncomeRows(db, budgetId, span, q.excluded_account_ids);
  return computeIncomeExpense({ income, spending, span });
}

export async function exportIncomeExpense(
  env: Env,
  budgetId: string,
  q: IncomeExpenseQuery,
): Promise<{ filename: string; csv: string }> {
  const data = await getIncomeExpense(env, budgetId, q);
  return {
    filename: `budget-reflect-income-expense-${q.today ?? utcToday()}.csv`,
    csv: incomeExpenseCsv(data),
  };
}

export async function listReportTransactions(
  env: Env,
  budgetId: string,
  q: ReportTransactionsQuery,
): Promise<{ transactions: ReportTransaction[] }> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  if (q.category_id !== undefined) {
    if ((await repo.findCategoryOrGroup(db, budgetId, "category", q.category_id)) === null) {
      throw new NotFound("Category");
    }
  } else if (q.group_id !== undefined) {
    if ((await repo.findCategoryOrGroup(db, budgetId, "group", q.group_id)) === null) {
      throw new NotFound("Category group");
    }
  } else if (q.income_payee_id !== undefined && q.income_payee_id !== NO_PAYEE_ID) {
    if ((await repo.findPayee(db, budgetId, q.income_payee_id)) === null) {
      throw new NotFound("Payee");
    }
  }
  const span = { start_month: q.start_month, end_month: q.end_month };
  if (q.income_payee_id !== undefined || q.income !== undefined) {
    const rows = await loadIncomeRows(db, budgetId, span, q.excluded_account_ids);
    const picked = rows.filter((r) =>
      q.income_payee_id === undefined
        ? true
        : q.income_payee_id === NO_PAYEE_ID
          ? r.payee_id === null
          : r.payee_id === q.income_payee_id,
    );
    return {
      transactions: picked.sort(newestFirst).map((r) => ({
        transaction_id: r.transaction_id,
        subtransaction_id: r.subtransaction_id,
        account_id: r.account_id,
        account_name: r.account_name,
        date: r.date,
        payee_name: r.payee_name,
        memo: r.memo,
        amount: r.amount,
        category_id: null,
        category_name: null,
        cleared: r.cleared,
      })),
    };
  }
  const rows = await loadSpendingRows(db, budgetId, span, {
    categories: q.excluded_category_ids,
    accounts: q.excluded_account_ids,
  });
  const picked = rows.filter((r) =>
    q.category_id !== undefined
      ? r.category_id === q.category_id
      : q.group_id !== undefined
        ? r.group_id === q.group_id
        : q.expenses !== undefined
          ? true
          : r.category_id === null,
  );
  return {
    transactions: picked.sort(newestFirst).map((r) => ({
      transaction_id: r.transaction_id,
      subtransaction_id: r.subtransaction_id,
      account_id: r.account_id,
      account_name: r.account_name,
      date: r.date,
      payee_name: r.payee_name,
      memo: r.memo,
      amount: r.amount,
      category_id: r.category_id,
      category_name: r.category_name,
      cleared: r.cleared,
    })),
  };
}

export async function exportSpendingBreakdown(
  env: Env,
  budgetId: string,
  q: SpendingBreakdownQuery,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const today = q.today ?? utcToday();
  const span = await spendingSpan(db, budgetId, q);
  const rows = await loadSpendingRows(db, budgetId, span, {
    categories: q.excluded_category_ids,
    accounts: q.excluded_account_ids,
  });
  const stem = `budget-reflect-spending-breakdown-${today}`;
  const bytes = storeZip(
    [
      { name: `${stem}.csv`, data: utf8(breakdownCsv(rows, span)) },
      {
        name: `${stem}-transactions.csv`,
        data: utf8(transactionsCsv([...rows].sort(newestFirst))),
      },
    ],
    today,
  );
  return { filename: `${stem}.zip`, bytes };
}
