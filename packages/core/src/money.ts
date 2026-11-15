/** Money is an integer number of milliunits: 1000 = one currency unit. Never use floats. */
export type Milliunits = number;

export function assertMilliunits(n: number): asserts n is Milliunits {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Not an integer milliunit amount: ${n}`);
}

/** "12.34" -> 12340. More than 3 decimals is an error (no silent rounding). */
export function toMilliunits(text: string): Milliunits {
  const m = /^(-)?(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!m) throw new RangeError(`Invalid money amount: ${text}`);
  const [, sign, whole = "0", frac = ""] = m;
  const value = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  assertMilliunits(value);
  return sign ? -value : value;
}

/** 12340 -> "12.340" (exactly 3 decimals). */
export function fromMilliunits(m: Milliunits): string {
  assertMilliunits(m);
  const abs = Math.abs(m);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, "0");
  return `${m < 0 ? "-" : ""}${whole}.${frac}`;
}

export function addMilliunits(...amounts: Milliunits[]): Milliunits {
  let total = 0;
  for (const a of amounts) {
    assertMilliunits(a);
    total += a;
  }
  assertMilliunits(total);
  return total;
}

export function formatMoney(
  m: Milliunits,
  opts: { currency?: string; locale?: string } = {},
): string {
  assertMilliunits(m);
  return new Intl.NumberFormat(opts.locale ?? "en-US", {
    style: "currency",
    currency: opts.currency ?? "USD",
  }).format(m / 1000);
}
