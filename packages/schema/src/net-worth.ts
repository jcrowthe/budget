/** Net Worth arithmetic (milliunits). Pure: the Worker and the tests give it the monthly sums. */
import { type Month, type MonthSpan, monthIndex, monthLabel, monthsIn } from "./report-range";

export interface NetWorthAccountRef {
  id: string;
  name: string;
}
export interface MonthlySum {
  account_id: string;
  month: Month;
  amount: number;
}
export interface NetWorthMonthResult {
  month: Month;
  assets: number;
  debts: number;
  net_worth: number;
  change: number;
  change_pct: number | null;
  accounts: { id: string; name: string; balance: number }[];
}
export interface NetWorthResult extends MonthSpan {
  first_month: Month;
  has_data: boolean;
  assets: number;
  debts: number;
  net_worth: number;
  change: number;
  change_pct: number | null;
  months: NetWorthMonthResult[];
}

const noNegZero = (n: number) => (n === 0 ? 0 : n);

/** change ÷ |base| × 100, rounded half away from zero to 1 decimal; null when the base is 0 and the change is not. */
export function percentChange(change: number, base: number): number | null {
  if (change === 0) return 0;
  if (base === 0) return null;
  const raw = (Math.abs(change) / Math.abs(base)) * 1000;
  const rounded = Math.round(raw + 1e-9) / 10;
  return noNegZero(change < 0 ? -rounded : rounded);
}

export function computeNetWorth(input: {
  accounts: NetWorthAccountRef[];
  sums: MonthlySum[];
  first_month: Month;
  start_month: Month;
  end_month: Month;
}): NetWorthResult {
  const { accounts, first_month, start_month, end_month } = input;
  const included = new Set(accounts.map((a) => a.id));
  const byAccount = new Map<string, Map<number, number>>();
  let hasData = false;
  for (const s of input.sums) {
    if (!included.has(s.account_id)) continue;
    const idx = monthIndex(s.month);
    if (idx > monthIndex(end_month)) continue;
    hasData = true;
    const m = byAccount.get(s.account_id) ?? new Map<number, number>();
    m.set(idx, (m.get(idx) ?? 0) + s.amount);
    byAccount.set(s.account_id, m);
  }
  const lo = Math.min(monthIndex(start_month), monthIndex(first_month)) - 1;
  const hi = monthIndex(end_month);
  const firstIdx = monthIndex(first_month);
  // Running balances from the earliest month needed, month by month.
  const earliestSum = [...byAccount.values()].flatMap((m) => [...m.keys()]);
  const startIdx = Math.min(lo, ...earliestSum);
  const running = new Map<string, number>();
  const snapshots = new Map<
    number,
    { assets: number; debts: number; accounts: NetWorthMonthResult["accounts"] }
  >();
  for (let i = startIdx; i <= hi; i++) {
    let assets = 0;
    let debts = 0;
    const rows = accounts.map((a) => {
      const bal = (running.get(a.id) ?? 0) + (byAccount.get(a.id)?.get(i) ?? 0);
      running.set(a.id, bal);
      if (bal > 0) assets += bal;
      else if (bal < 0) debts += bal;
      return { id: a.id, name: a.name, balance: noNegZero(bal) };
    });
    if (i >= monthIndex(start_month) - 1) snapshots.set(i, { assets, debts, accounts: rows });
  }
  const nw = (i: number) => {
    const s = snapshots.get(i);
    return s ? s.assets + s.debts : 0;
  };
  const months: NetWorthMonthResult[] = monthsIn({ start_month, end_month }).map((month) => {
    const i = monthIndex(month);
    const s = snapshots.get(i) as NonNullable<ReturnType<typeof snapshots.get>>;
    const net_worth = s.assets + s.debts;
    let change = 0;
    let change_pct: number | null = 0;
    if (i > firstIdx) {
      const prev = nw(i - 1);
      change = noNegZero(net_worth - prev);
      change_pct = percentChange(change, prev);
    }
    return {
      month,
      assets: s.assets,
      debts: noNegZero(s.debts),
      net_worth: noNegZero(net_worth),
      change,
      change_pct,
      accounts: s.accounts,
    };
  });
  const last = months[months.length - 1];
  const firstNw = months[0]?.net_worth ?? 0;
  const lastNw = last?.net_worth ?? 0;
  const change = noNegZero(lastNw - firstNw);
  return {
    first_month,
    start_month,
    end_month,
    has_data: hasData,
    assets: last?.assets ?? 0,
    debts: last?.debts ?? 0,
    net_worth: lastNw,
    change,
    change_pct: percentChange(change, firstNw),
    months,
  };
}

/** 12849260 -> "12849.26"; half away from zero; never "-0.00". */
export function csvAmount(milliunits: number): string {
  const cents = Math.round(Math.abs(milliunits) / 10);
  const s = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  return milliunits < 0 && cents !== 0 ? `-${s}` : s;
}

const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;

export function netWorthCsv(r: NetWorthResult): string {
  const lines = [[quote("Account"), ...r.months.map((m) => quote(monthLabel(m.month)))].join(",")];
  const first = r.months[0];
  for (const [i, a] of (first?.accounts ?? []).entries()) {
    lines.push(
      [quote(a.name), ...r.months.map((m) => csvAmount(m.accounts[i]?.balance ?? 0))].join(","),
    );
  }
  lines.push([quote("Net Worth"), ...r.months.map((m) => csvAmount(m.net_worth))].join(","));
  return lines.join("\n");
}
