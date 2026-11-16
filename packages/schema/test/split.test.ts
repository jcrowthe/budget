import { describe, expect, it } from "vitest";
import {
  autoDistribute,
  splitRemaining,
  splitRemainingColumns,
  splitSum,
  unbalancedText,
} from "../src/split";

describe("split arithmetic", () => {
  it("auto-distributes 60 and 25 of 100 in proportion", () => {
    expect(autoDistribute(-100000, [-60000, -25000])).toEqual([-70590, -29410]);
  });
  it("puts the rounding remainder on the last line", () => {
    const out = autoDistribute(-100000, [-10000, -10000, -10000]);
    expect(out).toEqual([-33330, -33330, -33340]);
    expect(splitSum(out)).toBe(-100000);
  });
  it("spreads equally when the lines sum to zero", () => {
    expect(autoDistribute(-100000, [0, 0, 0])).toEqual([-33330, -33330, -33340]);
  });
  it("keeps the total with mixed signs", () => {
    const out = autoDistribute(-50000, [-80000, 30000]);
    expect(splitSum(out)).toBe(-50000);
  });
  it("reads the remaining columns", () => {
    const col = (total: number, lines: number[]) =>
      splitRemainingColumns(splitRemaining(total, lines));
    expect(col(-100000, [-60000, -25000])).toEqual({ outflow: 15000, inflow: 0 });
    expect(col(100000, [60000, 25000])).toEqual({ outflow: 0, inflow: 15000 });
    expect(col(-100000, [-60000, -50000])).toEqual({ outflow: 0, inflow: 10000 });
    expect(col(-100000, [-60000, -40000])).toEqual({ outflow: 0, inflow: 0 });
  });
  it("words the dialog", () => {
    expect(unbalancedText(-100000, -85000)).toBe(
      "The total is -$100.00, but the splits add up to -$85.00. How would you like to handle the unassigned -$15.00?",
    );
  });
});
