import { addMonthsTo, monthOfDate } from "./report-range";

/** Age of Money: pure arithmetic. See docs/age-of-money-design.md for the definition. */
export const AOM_WINDOW = 10;

/** One row as the repository returns it, in its order (date, created_at, id). */
export interface AgeRow {
  date: string; // YYYY-MM-DD
  amount: number; // milliunits, signed
  account_id: string;
  transfer_account_id: string | null;
}
/** Age in days, not rounded. */
export interface OutflowAge {
  date: string;
  age: number;
}
export interface AgeOfMoneyResult {
  current_days: number | null;
  months: { month: string; days: number }[];
}

const DAY_MS = 86_400_000;
const utc = (d: string) =>
  Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Calendar days from `from` to `to` (UTC, so no time-zone shifts). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

export function outflowAges(
  rows: readonly AgeRow[],
  cash: ReadonlySet<string>,
  today: string,
): OutflowAge[] {
  const kept = rows
    .filter(
      (r) =>
        cash.has(r.account_id) &&
        r.amount !== 0 &&
        r.date <= today &&
        !(r.transfer_account_id !== null && cash.has(r.transfer_account_id)),
    )
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (a.r.date !== b.r.date) return a.r.date < b.r.date ? -1 : 1;
      const pa = a.r.amount > 0 ? 0 : 1;
      const pb = b.r.amount > 0 ? 0 : 1;
      return pa - pb || a.i - b.i;
    })
    .map((x) => x.r);

  const queue: { date: string; left: number }[] = [];
  let head = 0;
  const ages: OutflowAge[] = [];
  for (const row of kept) {
    if (row.amount > 0) {
      queue.push({ date: row.date, left: row.amount });
      continue;
    }
    let need = -row.amount;
    let weighted = 0;
    while (need > 0 && head < queue.length) {
      const b = queue[head] as { date: string; left: number };
      const t = Math.min(need, b.left);
      weighted += t * daysBetween(b.date, row.date);
      b.left -= t;
      need -= t;
      if (b.left === 0) head++;
    }
    ages.push({ date: row.date, age: weighted / -row.amount });
  }
  return ages;
}

/** The mean of the last 10 ages dated on or before `date`, rounded half up; null below 10. */
export function valueAt(ages: readonly OutflowAge[], date: string): number | null {
  let k = 0;
  while (k < ages.length && (ages[k] as OutflowAge).date <= date) k++;
  return valueOfFirst(ages, k);
}

function valueOfFirst(ages: readonly OutflowAge[], k: number): number | null {
  if (k < AOM_WINDOW) return null;
  let sum = 0;
  for (let i = k - AOM_WINDOW; i < k; i++) sum += (ages[i] as OutflowAge).age;
  return Math.floor(sum / AOM_WINDOW + 0.5 + 1e-9);
}

export function computeAgeOfMoney(
  rows: readonly AgeRow[],
  cash: ReadonlySet<string>,
  today: string,
): AgeOfMoneyResult {
  const ages = outflowAges(rows, cash, today);
  if (ages.length < AOM_WINDOW) return { current_days: null, months: [] };
  const months: { month: string; days: number }[] = [];
  const last = monthOfDate(today);
  let k = 0;
  for (
    let m = monthOfDate((ages[AOM_WINDOW - 1] as OutflowAge).date);
    m <= last;
    m = addMonthsTo(m, 1)
  ) {
    const next = addMonthsTo(m, 1);
    while (k < ages.length && monthOfDate((ages[k] as OutflowAge).date) < next) k++;
    months.push({ month: m, days: valueOfFirst(ages, k) as number });
  }
  return { current_days: (months[months.length - 1] as { days: number }).days, months };
}

/** A rounded top tick for the y axis: the next multiple of a fifth of the leading power of ten. */
export function aomTopTick(maxDays: number): number {
  if (maxDays <= 0) return 10;
  const step = Math.max(1, 10 ** Math.floor(Math.log10(maxDays)) / 5);
  return Math.ceil(maxDays / step) * step;
}

export function daysLabel(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}
