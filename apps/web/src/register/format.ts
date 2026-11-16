import { formatMoney } from "@budget/core/money";

/** ISO date to MM/DD/YYYY by slicing, so no time zone can move it (plan formats are EXF-468). */
export function registerDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export const registerMoney = (milliunits: number): string => formatMoney(Math.abs(milliunits));

const two = (n: number) => String(n).padStart(2, "0");

/** Today's date in the browser's local time zone, as ISO. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
