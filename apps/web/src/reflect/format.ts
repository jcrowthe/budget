import { formatMoney } from "@budget/core/money";

export const money = (m: number): string => formatMoney(m);
/** Debts are drawn negative: "-$4,750.00", and "-$0.00" at zero. */
export const debtsMoney = (m: number): string => `-${formatMoney(Math.abs(m))}`;
/** "+$3,300.00", "−$55.00" (U+2212), "$0.00". */
export const signedChange = (m: number): string =>
  m > 0 ? `+${formatMoney(m)}` : m < 0 ? `−${formatMoney(-m)}` : formatMoney(0);
const pct = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const percent = (p: number): string => `${pct.format(p)}%`;
/** Whole dollars for axis ticks. */
export const tickMoney = (m: number): string =>
  `${m < 0 ? "-" : ""}$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(m) / 1000)}`;
export const changeClass = (n: number): "positive" | "negative" | "zero" =>
  n > 0 ? "positive" : n < 0 ? "negative" : "zero";
