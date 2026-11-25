import { describe, expect, it } from "vitest";
import { MINIMUM_SUMMARY as DEBT_MINIMUM } from "../src/debt-target";
import {
  COPY_TO_PLAN,
  changeLines,
  ESCROW_NOTE,
  EXTRA_HINT,
  extraLabel,
  MINIMUM_SUMMARY,
  paymentHint,
  payoffHint,
  RESET_ALL,
  SIMULATION_TIP,
  TARGET_SUMMARY,
} from "../src/loan-simulator";
import { DEFAULT_FORMATTER } from "../src/plan-formats";

const money = DEFAULT_FORMATTER.abs;

describe("loan simulator copy", () => {
  it("the constants", () => {
    expect(SIMULATION_TIP).toBe(
      "Estimated future balance if you pay the updated amounts on the left side of the simulator.",
    );
    expect(EXTRA_HINT).toBe("Extra one-off payments can have a large impact on your loan.");
    expect(ESCROW_NOTE).toBe("Escrow amounts are not included");
    expect(COPY_TO_PLAN).toBe("Copy and go to my plan");
    expect(RESET_ALL).toBe("Reset all changes");
    expect(TARGET_SUMMARY).toBe("Paying your target every month:");
    expect(MINIMUM_SUMMARY).toBe(DEBT_MINIMUM);
  });

  it("paymentHint", () => {
    expect(paymentHint("target", 1500000, money)).toBe("$1,500.00 is your current monthly target.");
    expect(paymentHint("minimum", 1500000, money)).toBe(
      "$1,500.00 is your required minimum payment.",
    );
  });

  it("payoffHint", () => {
    expect(payoffHint({ changed: false, n: 357, originalPayoff: "2056-08-01" })).toBe(
      "You have 357 payments remaining on your loan.",
    );
    expect(payoffHint({ changed: true, n: 357, originalPayoff: "2056-08-01" })).toBe(
      "Your original payoff date is Aug 2056",
    );
  });

  it("extraLabel names the month in full", () => {
    expect(extraLabel("2026-11-01")).toBe("One time extra in November");
    expect(extraLabel("2027-01-01")).toBe("One time extra in January");
  });

  it("changeLines", () => {
    expect(changeLines({ deltaMonthly: 500000, extra: 0 }, money)).toEqual([
      "Paying +$500.00 extra every month",
    ]);
    expect(changeLines({ deltaMonthly: -200000, extra: 0 }, money)).toEqual([
      "Paying $200.00 less every month",
    ]);
    expect(changeLines({ deltaMonthly: 0, extra: 10000000 }, money)).toEqual([
      "Paying +$10,000.00 extra this month",
    ]);
    expect(changeLines({ deltaMonthly: 500000, extra: 10000000 }, money)).toHaveLength(2);
    expect(changeLines({ deltaMonthly: 0, extra: 0 }, money)).toEqual([]);
  });
});
