import { displayGroup, sidebarSections } from "@budget/core/account-types";
import { computeNetWorth, netWorthCsv } from "@budget/schema/net-worth";
import {
  addMonthsTo,
  monthOfDate,
  planFirstMonth,
  type RangeFacts,
  resolveRange,
} from "@budget/schema/report-range";
import type {
  NetWorth,
  NetWorthQuery,
  ReportRange,
  ReportRangeQuery,
} from "@budget/schema/reports";
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
