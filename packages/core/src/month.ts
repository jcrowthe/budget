/** A month is identified by its first day, ISO 8601: "2026-11-01". */
export type Month = string;

const MONTH_RE = /^(\d{4})-(\d{2})-01$/;

export function isMonth(s: string): s is Month {
  const m = MONTH_RE.exec(s);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

function build(year: number, monthIndex: number): Month {
  const y = year + Math.floor(monthIndex / 12);
  const mo = ((monthIndex % 12) + 12) % 12;
  return `${String(y).padStart(4, "0")}-${String(mo + 1).padStart(2, "0")}-01`;
}

/** "2026-11-15" -> "2026-11-01". */
export function toMonth(isoDate: string): Month {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RangeError(`Invalid date: ${isoDate}`);
  return `${m[1]}-${m[2]}-01`;
}

/** The month containing `now`, in UTC. */
export function currentMonth(now: Date = new Date()): Month {
  return build(now.getUTCFullYear(), now.getUTCMonth());
}

export function addMonths(month: Month, n: number): Month {
  if (!isMonth(month)) throw new RangeError(`Not a month: ${month}`);
  const y = Number(month.slice(0, 4));
  const mo = Number(month.slice(5, 7)) - 1;
  return build(y, mo + n);
}

/** "2026-11-01" -> "202611". */
export function monthKey(month: Month): string {
  if (!isMonth(month)) throw new RangeError(`Not a month: ${month}`);
  return month.slice(0, 4) + month.slice(5, 7);
}
