import { assertMilliunits } from "@budget/core/money";

/** Plaid sends decimal numbers; convert through the decimal string so no float multiplication drifts. */
export function plaidToMilliunits(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n)) throw new RangeError("Plaid amount is not finite");
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(6);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError("Plaid amount is not a decimal");
  const frac = (m[3] ?? "").padEnd(4, "0");
  let milli = Number(m[2]) * 1000 + Number(frac.slice(0, 3));
  if (Number(frac[3]) >= 5) milli += 1;
  const out = milli === 0 ? 0 : m[1] ? -milli : milli;
  assertMilliunits(out);
  return out;
}

/** A bank account's balance (milliunits, Plaid's sign) as the plan stores it: credit and loan balances are owed, so negative. null → 0; never -0. */
export function bankBalanceToPlan(plaidType: string, milli: number | null): number {
  if (milli === null || milli === 0) return 0;
  const t = plaidType.toLowerCase();
  return t === "credit" || t === "loan" ? -milli : milli;
}
