import type { TargetDefinition } from "@budget/core/targets";
import type { MonthCategoryDetail } from "@budget/schema/months";
import { describe, expect, it } from "vitest";
import { targetAmountForMonth } from "../src/services/months-targets";

// EXF-525: the flat amount of one target in one month (pure). Milliunits.

const NOV = "2026-11-01";
const base: TargetDefinition = {
  cadence: "monthly",
  behavior: "set_aside",
  amount: 10000,
  day_of_week: null,
  day_of_month: null,
  due_date: null,
  due_month: null,
  repeat: null,
  created_on: "2026-11-15",
};
const cat = (
  def: Partial<TargetDefinition> | null,
  extra: { kind?: string | null; card?: number } = {},
): MonthCategoryDetail =>
  ({
    kind: extra.kind ?? null,
    target: def
      ? {
          definition: { ...base, ...def },
          amount_this_month: extra.card ?? 0,
          status: "underfunded",
        }
      : null,
  }) as unknown as MonthCategoryDetail;
const amount = (def: Partial<TargetDefinition> | null, at = NOV, extra = {}) =>
  targetAmountForMonth(cat(def, extra), at);

describe("targetAmountForMonth", () => {
  it("is 0 without a target", () => expect(amount(null)).toBe(0));
  it("monthly: the amount, whatever the behaviour", () => {
    expect(amount({})).toBe(10000);
    expect(amount({ behavior: "refill" })).toBe(10000);
  });
  it("weekly: the full month's weekdays, the creation month included", () => {
    expect(amount({ cadence: "weekly", day_of_week: 6 })).toBe(40000);
    expect(amount({ cadence: "weekly", day_of_week: 2 }, "2026-12-01")).toBe(50000);
    expect(amount({ cadence: "weekly", day_of_week: null })).toBe(40000);
  });
  it("yearly: a twelfth with a date, 0 without", () => {
    expect(amount({ cadence: "yearly", amount: 120000, due_date: "2027-10-31" })).toBe(10000);
    expect(amount({ cadence: "yearly", amount: 120000 })).toBe(0);
  });
  it("custom balance: spread to the date, 0 without or after it", () => {
    const d = { cadence: "custom", behavior: "balance", amount: 60000 } as const;
    expect(amount({ ...d, due_month: "2027-04-01" })).toBe(10000);
    expect(amount({ ...d, due_month: "2027-04-01" }, "2027-04-01")).toBe(60000);
    expect(amount({ ...d })).toBe(0);
    expect(amount({ ...d, due_month: "2026-10-01" })).toBe(0);
  });
  it("custom set_aside / fill_up: spread over the current period; repeating rolls on", () => {
    const d = { cadence: "custom", behavior: "set_aside", amount: 30000 } as const;
    expect(amount({ ...d, due_date: "2027-01-31" })).toBe(10000);
    expect(amount({ ...d, behavior: "fill_up", due_date: "2027-01-31" })).toBe(10000);
    expect(amount({ ...d, due_date: "2026-10-31" })).toBe(0);
    expect(amount({ ...d })).toBe(0);
    const rep = { ...d, due_date: "2026-10-31", repeat: { every: 3, unit: "month" } } as const;
    // Period due 2027-01: three months left from November.
    expect(amount(rep)).toBe(10000);
  });
  it("a month before creation is 0", () => {
    expect(amount({ created_on: "2026-12-02" })).toBe(0);
  });
  it("card payoff by date: the engine's figure", () => {
    const c = cat(
      { cadence: "custom", behavior: "balance", amount: 0, due_month: "2027-04-01" },
      { kind: "credit_card_payment", card: 24000 },
    );
    expect(targetAmountForMonth(c, NOV)).toBe(24000);
  });
});
