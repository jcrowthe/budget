/** Reflect's money and axis formatting (milliunits). Pure; a zero is never printed with a minus sign (EXF-591). */

/** Milliunits as whole cents, rounded half away from zero; never -0. */
export function cents(m: number): number {
  const c = Math.sign(m) * Math.round(Math.abs(m) / 10);
  return c === 0 ? 0 : c;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$1,234.50", "-$55.00" and "$0.00" at zero cents. */
export function reportMoney(m: number): string {
  const c = cents(m);
  return c === 0 ? "$0.00" : usd.format(c / 100);
}

/** Debts are drawn negative: "-$4,750.00", and "$0.00" at zero. */
export function debtsMoney(m: number): string {
  return cents(m) === 0 ? "$0.00" : `-${reportMoney(Math.abs(m))}`;
}

/** "+$3,300.00", "−$55.00" (U+2212), "$0.00". */
export function signedChange(m: number): string {
  const c = cents(m);
  return c > 0 ? `+${reportMoney(m)}` : c < 0 ? `−${reportMoney(-m)}` : "$0.00";
}

/** The drill-down's amount: "+$20.00", "-$150.00" (hyphen), "$0.00". */
export function drillAmount(m: number): string {
  const c = cents(m);
  return c > 0 ? `+${reportMoney(m)}` : c < 0 ? `-${reportMoney(-m)}` : "$0.00";
}

/** Whole dollars for axis ticks; the minus sign only when the rounded dollar is not zero. */
export function tickMoney(m: number): string {
  const dollars = Math.round(Math.abs(m) / 1000);
  const text = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(dollars);
  return `${m < 0 && dollars !== 0 ? "-" : ""}$${text}`;
}

/** "2026-10-21" -> "10/21/2026". */
export function usDate(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
}

/**
 * Whole-dollar-friendly ticks (milliunits) covering [min, max]: strictly increasing, at most `count`, a step never
 * below one dollar (so no two labels repeat). None when everything is zero.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === 0 && max === 0) return [];
  const range = (max - min) / 1000 || 1;
  const rough = range / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  for (const f of [1, 2, 2.5, 5, 10, 20]) {
    const step = Math.max(1000, f * mag * 1000);
    const lo = Math.floor(min / step);
    const hi = Math.ceil(max / step);
    if (hi - lo + 1 <= count) {
      return Array.from({ length: hi - lo + 1 }, (_, k) => Math.round((lo + k) * step) || 0);
    }
  }
  return [];
}
