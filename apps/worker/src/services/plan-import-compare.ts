import {
  CREDIT_ACCOUNT_TYPES,
  startingBalanceFeedsReadyToAssign,
} from "@budget/core/account-types";
import { computeMonth, type EngineActivity, type EngineInput } from "@budget/core/budget-engine";
import { addMonths } from "@budget/core/month";
import { IMPORT_LIMITS, type ImportMismatch, type ImportPlan } from "@budget/schema/plan-import";

/**
 * The engine's input for the plan an import describes (keys are the ids). The activity follows `planActivity`'s
 * rules (repositories/plan-activity.ts) over the ImportPlan instead of the database: split parents count nothing,
 * the cash side of an on-plan transfer counts nowhere, the card side is a `transfer`, a card's uncategorized
 * Starting Balance feeds nothing. Rows are pre-summed per month so the engine works on a few thousand rows.
 */
export function engineInputOf(plan: ImportPlan): EngineInput {
  const isCard = (a: number) =>
    (CREDIT_ACCOUNT_TYPES as readonly string[]).includes(
      (plan.accounts[a] as { type: string }).type,
    );
  const hasLines = new Set<number>();
  for (const t of plan.transactions) if (t.parent !== null) hasLines.add(t.parent);
  const lastMonth = plan.months[plan.months.length - 1];
  const before = lastMonth === undefined ? "" : addMonths(lastMonth, 1);

  const sums = new Map<string, EngineActivity>();
  plan.transactions.forEach((t, i) => {
    if (before === "" || t.date >= before || hasLines.has(i)) return;
    const acct = plan.accounts[t.account] as ImportPlan["accounts"][number];
    const other =
      t.transferAccount === null
        ? null
        : (plan.accounts[t.transferAccount] as ImportPlan["accounts"][number]);
    const xfer = other !== null && acct.onBudget && other.onBudget;
    const card = isCard(t.account);
    if (xfer && !card) return;
    if (
      acct.onBudget &&
      !startingBalanceFeedsReadyToAssign(acct.type) &&
      t.payee !== null &&
      plan.payees[t.payee]?.system === "starting_balance" &&
      t.category === null &&
      !t.inflowToRta
    ) {
      return;
    }
    const category = xfer ? null : t.category;
    const accountId = card ? String(t.account) : null;
    const key = `${t.date.slice(0, 7)}|${category}|${t.inflowToRta}|${acct.onBudget}|${acct.type}|${accountId}|${xfer}`;
    const row = sums.get(key);
    if (row) row.amount += t.amount;
    else {
      sums.set(key, {
        date: `${t.date.slice(0, 7)}-01`,
        amount: t.amount,
        categoryId: category === null ? null : String(category),
        inflowToReadyToAssign: t.inflowToRta,
        onBudget: acct.onBudget,
        accountType: acct.type,
        accountId,
        transfer: xfer,
      });
    }
  });
  return {
    groups: plan.groups.map((g, i) => ({
      id: String(i),
      name: g.name,
      sortOrder: g.sort,
      hidden: false,
      collapsed: false,
      kind: g.kind,
    })),
    categories: plan.categories.map((c, i) => ({
      id: String(i),
      groupId: String(c.group),
      name: c.name,
      sortOrder: c.sort,
      hidden: c.hidden,
      kind: c.paymentAccount === null ? null : ("credit_card_payment" as const),
      accountId: c.paymentAccount === null ? null : String(c.paymentAccount),
    })),
    assignments: plan.assignments.map((a) => ({
      categoryId: String(a.category),
      month: a.month,
      assigned: a.assigned,
    })),
    activity: [...sums.values()],
    notes: [],
  };
}

/**
 * Recomputes each Plan month with the engine and compares Activity and Available with the file's. `figures` holds
 * the recomputed numbers by `${category}|${month}`; `mismatches` at most IMPORT_LIMITS.mismatches of them.
 */
export function compareImport(plan: ImportPlan): {
  figures: Map<string, { activity: number; available: number }>;
  mismatches: ImportMismatch[];
  mismatchCount: number;
} {
  const figures = new Map<string, { activity: number; available: number }>();
  const mismatches: ImportMismatch[] = [];
  let mismatchCount = 0;
  if (plan.planRows.length === 0) return { figures, mismatches, mismatchCount };
  const input = engineInputOf(plan);
  const byMonth = new Map<string, ImportPlan["planRows"]>();
  for (const r of plan.planRows) {
    const list = byMonth.get(r.month);
    if (list) list.push(r);
    else byMonth.set(r.month, [r]);
  }
  const groupName = (c: number) =>
    plan.groups[(plan.categories[c] as { group: number }).group]?.name ?? "";
  for (const month of plan.months) {
    const detail = computeMonth(input, month);
    const cats = new Map<string, { activity: number; available: number }>();
    for (const g of detail.groups) for (const c of g.categories) cats.set(c.id, c);
    for (const r of byMonth.get(month) ?? []) {
      const got = cats.get(String(r.category)) ?? { activity: 0, available: 0 };
      figures.set(`${r.category}|${month}`, { activity: got.activity, available: got.available });
      for (const column of ["activity", "available"] as const) {
        if (got[column] === r[column]) continue;
        mismatchCount++;
        if (mismatches.length < IMPORT_LIMITS.mismatches) {
          mismatches.push({
            category: `${groupName(r.category)}: ${(plan.categories[r.category] as { name: string }).name}`,
            month,
            column,
            expected: r[column],
            got: got[column],
          });
        }
      }
    }
  }
  return { figures, mismatches, mismatchCount };
}
