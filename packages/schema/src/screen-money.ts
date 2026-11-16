/** The one formatter for amounts shown on a screen (EXF-664). Files for other programs keep the ASCII hyphen. */

/** The minus sign (U+2212). */
export const MINUS = "−";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Milliunits as "$1,234.50" or "−$444.00" (U+2212 before the `$`); a zero amount is never negative. */
export function screenMoney(m: number): string {
  const text = usd.format(m / 1000);
  if (text === "-$0.00") return "$0.00";
  return text.startsWith("-") ? `${MINUS}${text.slice(1)}` : text;
}
