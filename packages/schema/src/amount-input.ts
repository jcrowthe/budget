/** Form text → milliunits, or null when it is not a plain amount. */
export function parseAmountInput(text: string, digits = 2): number | null {
  const fraction = digits > 0 ? `(?:\\.(\\d{1,${digits}}))?` : "";
  const m = new RegExp(`^(-)?(\\$)?(-)?(\\d+|\\d{1,3}(?:,\\d{3})+)?${fraction}$`).exec(text.trim());
  if (!m) return null;
  const [, neg1, , neg2, whole, frac] = m;
  if (neg1 && neg2) return null;
  if (whole === undefined && frac === undefined) return null;
  const units = Number((whole ?? "0").replaceAll(",", ""));
  const cents = Number((frac ?? "").padEnd(digits, "0") || "0");
  const milli = units * 1000 + cents * 10 ** (3 - digits);
  if (!Number.isSafeInteger(units * 1000) || !Number.isSafeInteger(milli)) return null;
  return neg1 || neg2 ? (milli === 0 ? 0 : -milli) : milli;
}
