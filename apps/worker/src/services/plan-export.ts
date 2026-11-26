import { LOAN_ACCOUNT_TYPES } from "@budget/core/account-types";
import { addMonths } from "@budget/core/month";
import {
  categoryCell,
  exportFormat,
  exportMonthCeiling,
  exportNames,
  type LoanExport,
  nowRangeText,
  nowWithinServerDays,
  planFile,
  type RegisterEntry,
  type RegisterLine,
  registerFile,
  SYSTEM_PAYEE_NAMES,
  utcMinute,
} from "@budget/schema/plan-export";
import { planFormatter } from "@budget/schema/plan-formats";
import { transferPayeeName } from "@budget/schema/transfers";
import { storeZip, utf8 } from "@budget/schema/zip";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as exportRepo from "../repositories/plan-export";
import * as scheduledRepo from "../repositories/scheduled-transactions";
import * as txRepo from "../repositories/transactions";
import { flagLabelOfRow, formatsOfRow } from "./budgets";
import { getMonthRange, getPlanMonths } from "./months";
import { planClock } from "./plan-clock";

/** `now` is further from the server's date than one day (EXF-670); the route answers 422. */
export class ExportNowOutOfRange extends Error {
  constructor(serverToday: string) {
    super(`now must be within one day of the server's date (${nowRangeText(serverToday)})`);
    this.name = "ExportNowOutOfRange";
  }
}

/**
 * Export Plan: the whole plan as a zip of the Plan file and the Register file (docs/plan-export-design.md).
 * Read-only. 15 D1 calls whatever the plan's size: the plan (1), the month range (2), the engine's read of the
 * plan (8), accounts (1), transactions (1), split lines (1), schedules (1) and, since EXF-885 5a, renaming rules (1;
 * the count above is older than the card, loan and rule reads, see plan-export-calls.test.ts). Everything else is in memory.
 */
export async function exportPlan(
  env: Env,
  budgetId: string,
  q: { now?: string },
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const db = getDb(env);
  const serverNow = planClock.now();
  const serverToday = serverNow.toISOString().slice(0, 10);
  const plan = await budgetsRepo.findActive(db, budgetId);
  if (!plan) throw new NotFound("Plan");
  if (q.now !== undefined && !nowWithinServerDays(q.now, serverToday)) {
    throw new ExportNowOutOfRange(serverToday);
  }
  const now = q.now ?? utcMinute(serverNow);
  const today = now.slice(0, 10);
  const current = `${today.slice(0, 7)}-01`;

  const range = await getMonthRange(env, budgetId);
  const first = range.first_month < current ? range.first_month : current;
  const lastAssigned = range.last_assigned_month ?? current;
  const wanted = lastAssigned > current ? lastAssigned : current;
  // Money assigned further ahead than the bound is not written (EXF-670).
  const ceiling = exportMonthCeiling(serverToday);
  const last = wanted > ceiling ? ceiling : wanted;
  const months: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) months.push(m);

  const [details, accounts, txs, lines, schedules, rules] = await Promise.all([
    getPlanMonths(env, budgetId, months, today),
    accountsRepo.list(db, budgetId, { includeClosed: true }),
    txRepo.listDetailForPlan(db, budgetId),
    txRepo.listLines(db, budgetId, {}),
    scheduledRepo.listForPlan(db, budgetId),
    exportRepo.listRulesForExport(db, budgetId),
  ]);

  const known = new Map<string, { group: string; name: string; hidden: boolean }>();
  for (const g of details[0]?.groups ?? []) {
    for (const c of g.categories) {
      known.set(c.id, { group: g.name, name: c.name, hidden: c.hidden || g.hidden });
    }
  }
  const acct = new Map(
    accounts.map((a, i) => [a.id, { name: a.name, rank: i, onBudget: a.onBudget }]),
  );
  const linesOf = new Map<string, txRepo.LineRow[]>();
  for (const l of lines) {
    if (!l.parentTransactionId) continue;
    const list = linesOf.get(l.parentTransactionId);
    if (list) list.push(l);
    else linesOf.set(l.parentTransactionId, [l]);
  }

  // Loan accounts' fields (EXF-991); the pairing as the group and category names the Plan file writes.
  const loans = new Map<string, LoanExport>();
  for (const a of accounts) {
    if (!LOAN_ACCOUNT_TYPES.includes(a.type)) continue;
    const paired = a.pairedCategoryId ? known.get(a.pairedCategoryId) : undefined;
    loans.set(a.name, {
      type: a.type,
      interestRate: a.interestRate,
      minimumPayment: a.minimumPayment,
      escrowAmount: a.escrowAmount,
      pairedGroup: paired ? (paired.hidden ? "Hidden Categories" : paired.group) : null,
      pairedCategory: paired?.name ?? null,
    });
  }

  const entries: RegisterEntry[] = [];
  for (const r of txs) {
    const a = acct.get(r.accountId);
    if (!a) continue;
    const payee = r.transferAccountId
      ? (r.payeeName ?? "")
      : r.payeeSystem
        ? SYSTEM_PAYEE_NAMES[r.payeeSystem]
        : (r.payeeName ?? "");
    const own: RegisterLine[] = (linesOf.get(r.id) ?? []).map((l) => ({
      payee: l.transferAccountId
        ? transferPayeeName(acct.get(l.transferAccountId)?.name ?? "")
        : l.payeeName,
      memo: l.memo,
      amount: l.amount,
      category: categoryCell({
        onBudget: a.onBudget,
        categoryId: l.categoryId,
        inflowToRta: l.inflowToReadyToAssign,
        known: l.categoryId ? known.get(l.categoryId) : undefined,
        joined: { group: l.groupName, name: l.categoryName },
      }),
    }));
    entries.push({
      account: r.accountName,
      accountRank: a.rank,
      date: r.date,
      amount: r.amount,
      payee,
      flag: r.flagColor ?? null,
      cleared: r.cleared,
      memo: r.memo,
      category: categoryCell({
        onBudget: a.onBudget,
        categoryId: r.categoryId,
        inflowToRta: r.inflowToReadyToAssign,
        known: r.categoryId ? known.get(r.categoryId) : undefined,
        joined: { group: r.groupName, name: r.categoryName },
      }),
      lines: own,
      scheduled: false,
      createdAt: r.createdAt,
      id: r.id,
    });
  }
  for (const s of schedules) {
    const other = s.transferAccountId ? acct.get(s.transferAccountId) : undefined;
    const category = (onBudget: boolean, carries: boolean) =>
      categoryCell({
        onBudget,
        categoryId: carries ? s.categoryId : null,
        inflowToRta: carries ? s.inflowToReadyToAssign : false,
        known: carries && s.categoryId ? known.get(s.categoryId) : undefined,
        joined: carries
          ? { group: s.groupName, name: s.categoryName }
          : { group: null, name: null },
      });
    // A transfer schedule is two scheduled rows, one in each account, like the two sides of a transfer; the category
    // belongs to the on-plan side of an on-plan to tracking transfer.
    entries.push({
      account: s.accountName,
      accountRank: acct.get(s.accountId)?.rank ?? 0,
      date: s.dateNext,
      amount: s.amount,
      payee: other ? transferPayeeName(other.name) : (s.payeeName ?? ""),
      flag: s.flagColor ?? null,
      cleared: "uncleared",
      memo: s.memo,
      category: category(s.accountOnBudget, !other || (s.accountOnBudget && !other.onBudget)),
      lines: [],
      scheduled: true,
      createdAt: s.createdAt,
      id: s.id,
    });
    if (other) {
      entries.push({
        account: other.name,
        accountRank: other.rank,
        date: s.dateNext,
        // `0 - x` keeps zero positive.
        amount: 0 - s.amount,
        payee: transferPayeeName(s.accountName),
        flag: null,
        cleared: "uncleared",
        memo: s.memo,
        category: category(other.onBudget, !s.accountOnBudget && other.onBudget),
        lines: [],
        scheduled: true,
        createdAt: s.createdAt,
        id: `${s.id}:mirror`,
      });
    }
  }

  const fmt = exportFormat(planFormatter(formatsOfRow(plan)).planFormat());
  const names = exportNames(plan.name, now, fmt.extension);
  const bytes = storeZip(
    [
      { name: names.plan, data: utf8(planFile(details, fmt)) },
      {
        name: names.register,
        data: utf8(registerFile(entries, fmt, flagLabelOfRow(plan), loans, rules)),
      },
    ],
    today,
    now.slice(11, 16),
  );
  return { fileName: names.zip, bytes };
}
