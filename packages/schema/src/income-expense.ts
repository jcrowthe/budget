/**
 * Income v Expense arithmetic (milliunits, integers only). Pure: the Worker gives it the income rows (`incomeRows`)
 * and the spending rows (`spendingRows`) of the span; "today" never enters here.
 */
import { csvAmount } from "./net-worth";
import { type MonthSpan, monthCount, monthLabel, monthsIn } from "./report-range";
import type { IncomeExpense, ReportFigures } from "./reports";
import { centsRound, type SpendingRow } from "./spending-breakdown";

/** One income row: a plain transaction, or one line of a split, sent to Ready to Assign. Signed. */
export interface IncomeRow {
  id: string;
  transaction_id: string;
  subtransaction_id: string | null;
  account_id: string;
  account_name: string;
  date: string;
  created_at: string;
  split_index: number | null;
  amount: number;
  payee_id: string | null;
  payee_name: string | null;
  memo: string | null;
  cleared: "uncleared" | "cleared" | "reconciled";
}

/** The drill-down's selector for rows with no payee. */
export const NO_PAYEE_ID = "none";
export const NO_PAYEE_NAME = "(no payee)";
const UNCATEGORIZED_ROW = "Uncategorized Transactions";

export function filterIncome(
  rows: readonly IncomeRow[],
  excludedAccountIds: readonly string[],
): IncomeRow[] {
  const accts = new Set(excludedAccountIds);
  return rows.filter((r) => !accts.has(r.account_id));
}

/** A running row: one sum per month. */
class Sums {
  readonly sums: number[];
  constructor(n: number) {
    this.sums = new Array<number>(n).fill(0);
  }
  add(i: number, amount: number) {
    this.sums[i] = (this.sums[i] ?? 0) + amount;
  }
}

const figures = (months: readonly number[]): ReportFigures => {
  const total = months.reduce((a, b) => a + b, 0);
  return { months: [...months], average: centsRound(total, months.length), total };
};

const sumOf = (rows: readonly (readonly number[])[], n: number): number[] =>
  Array.from({ length: n }, (_, i) => rows.reduce((s, r) => s + (r[i] ?? 0), 0));

export function computeIncomeExpense(input: {
  income: readonly IncomeRow[];
  spending: readonly SpendingRow[];
  span: MonthSpan;
}): IncomeExpense {
  const { span } = input;
  const months = monthsIn(span);
  const n = monthCount(span);
  const at = (date: string) => months.indexOf(`${date.slice(0, 7)}-01`);

  const payees = new Map<string, { id: string | null; name: string; sums: Sums }>();
  for (const r of input.income) {
    const i = at(r.date);
    if (i < 0) continue;
    const key = r.payee_id ?? NO_PAYEE_ID;
    const p = payees.get(key) ?? {
      id: r.payee_id,
      name: r.payee_name ?? NO_PAYEE_NAME,
      sums: new Sums(n),
    };
    p.sums.add(i, r.amount);
    payees.set(key, p);
  }
  const payeeRows = [...payees.values()].sort((a, b) => {
    if ((a.id === null) !== (b.id === null)) return a.id === null ? 1 : -1;
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });

  let uncategorized: Sums | null = null;
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      order: number;
      categories: Map<
        string,
        { id: string; name: string; hidden: boolean; order: number; sums: Sums }
      >;
    }
  >();
  for (const r of input.spending) {
    const i = at(r.date);
    if (i < 0) continue;
    if (r.category_id === null || r.group_id === null) {
      uncategorized ??= new Sums(n);
      uncategorized.add(i, r.amount);
      continue;
    }
    const g = groups.get(r.group_id) ?? {
      id: r.group_id,
      name: r.group_name ?? "",
      order: r.group_order,
      categories: new Map(),
    };
    const c = g.categories.get(r.category_id) ?? {
      id: r.category_id,
      name: r.category_name ?? "",
      hidden: r.category_hidden || r.group_hidden,
      order: r.category_order,
      sums: new Sums(n),
    };
    c.sums.add(i, r.amount);
    g.categories.set(r.category_id, c);
    groups.set(r.group_id, g);
  }

  const groupRows = [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => {
      const cats = [...g.categories.values()].sort((a, b) => a.order - b.order);
      return {
        id: g.id,
        name: g.name,
        categories: cats.map((c) => ({
          id: c.id,
          name: c.name,
          hidden: c.hidden,
          ...figures(c.sums.sums),
        })),
        total: figures(
          sumOf(
            cats.map((c) => c.sums.sums),
            n,
          ),
        ),
      };
    });

  const incomeTotal = sumOf(
    payeeRows.map((p) => p.sums.sums),
    n,
  );
  const expenseTotal = sumOf(
    [...(uncategorized ? [uncategorized.sums] : []), ...groupRows.map((g) => g.total.months)],
    n,
  );

  return {
    start_month: span.start_month,
    end_month: span.end_month,
    months,
    income: {
      payees: payeeRows.map((p) => ({ payee_id: p.id, name: p.name, ...figures(p.sums.sums) })),
      total: figures(incomeTotal),
    },
    expense: {
      uncategorized: uncategorized ? figures(uncategorized.sums) : null,
      groups: groupRows,
      total: figures(expenseTotal),
    },
    net_income: figures(sumOf([incomeTotal, expenseTotal], n)),
  };
}

const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;

/** The export: no BOM, LF, no trailing newline. A group row holds its subtotal; there is no "Total <group>" row. */
export function incomeExpenseCsv(d: IncomeExpense): string {
  const row = (name: string, f: ReportFigures) =>
    [quote(name), ...f.months.map(csvAmount), csvAmount(f.average), csvAmount(f.total)].join(",");
  const lines = [
    [
      quote("Category"),
      ...d.months.map((m) => quote(monthLabel(m))),
      quote("Average"),
      quote("Total"),
    ].join(","),
  ];
  if (d.income.payees.length > 0) lines.push(row("All Income Sources", d.income.total));
  for (const p of d.income.payees) lines.push(row(p.name, p));
  lines.push(row("Total Income", d.income.total));
  if (d.expense.uncategorized) lines.push(row(UNCATEGORIZED_ROW, d.expense.uncategorized));
  for (const g of d.expense.groups) {
    lines.push(row(g.name, g.total));
    for (const c of g.categories) lines.push(row(c.name, c));
  }
  lines.push(row("Total Expenses", d.expense.total));
  lines.push(row("Net Income", d.net_income));
  return lines.join("\n");
}
