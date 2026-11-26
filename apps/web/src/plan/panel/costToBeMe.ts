/** Rounded to 3 decimals (82.872). */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export type CostBars = {
  /** Income is below the targets: the targets bar is the deficit colour. */
  deficit: boolean;
  /** Width of the targets bar, a percentage. */
  targetsPct: number;
  /** Width of the income bar, a percentage. */
  incomePct: number;
};

/**
 * EXF-525: the two comparison bars of Cost to Be Me. Below the targets the targets bar is full and the income
 * bar is income ÷ targets; otherwise the income bar is full and the targets bar is targets ÷ income.
 * `income` is above 0 (an unset income shows no bars).
 */
export function costBars(total: number, income: number): CostBars {
  if (income < total)
    return { deficit: true, targetsPct: 100, incomePct: round3((income / total) * 100) };
  return {
    deficit: false,
    targetsPct: income > 0 ? round3((total / income) * 100) : 0,
    incomePct: 100,
  };
}
