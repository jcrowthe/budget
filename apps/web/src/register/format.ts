import { formatMoney } from "@budget/core/money";

/** ISO date to MM/DD/YYYY by slicing, so no time zone can move it (plan formats are EXF-468). */
export function registerDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export const registerMoney = (milliunits: number): string => formatMoney(Math.abs(milliunits));
