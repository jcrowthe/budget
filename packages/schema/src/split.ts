/** Split arithmetic, all in milliunits (1000 = one unit, an outflow is negative). */

export const splitSum = (lines: readonly number[]): number => lines.reduce((a, b) => a + b, 0);

/** What is left of the total to assign: total minus the lines' sum. */
export const splitRemaining = (total: number, lines: readonly number[]): number =>
  total - splitSum(lines);

/** The remaining amount as the two columns of the editor; never negative. */
export function splitRemainingColumns(r: number): { outflow: number; inflow: number } {
  if (r < 0) return { outflow: -r, inflow: 0 };
  if (r > 0) return { outflow: 0, inflow: r };
  return { outflow: 0, inflow: 0 };
}

const toCents = (milli: number) => Math.round(milli / 10) * 10;

/** Spreads the total over the lines in proportion; cents rounded, the remainder lands on the last line. */
export function autoDistribute(total: number, lines: readonly number[]): number[] {
  if (lines.length === 0) return [];
  const sum = splitSum(lines);
  const out: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const share = sum === 0 ? total / lines.length : ((lines[i] as number) * total) / sum;
    out.push(toCents(share));
  }
  out.push(total - splitSum(out));
  return out;
}

export function unbalancedText(total: number, sum: number): string {
  // The schema package does not depend on core, so the same en-US dollar format is spelled here.
  const f = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 1000);
  return `The total is ${f(total)}, but the splits add up to ${f(sum)}. How would you like to handle the unassigned ${f(total - sum)}?`;
}
