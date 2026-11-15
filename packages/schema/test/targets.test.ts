import { describe, expect, it } from "vitest";
import { TargetSet } from "../src/targets";

const base = {
  budget_id: "00000000-0000-4000-8000-000000000001",
  category_id: "00000000-0000-4000-8000-000000000002",
};
const ok = (o: object) => TargetSet.safeParse({ ...base, ...o }).success;

describe("TargetSet", () => {
  it("accepts one valid body of each kind", () => {
    expect(ok({ cadence: "monthly", behavior: "set_aside", amount: 100000 })).toBe(true);
    expect(
      ok({ cadence: "monthly", behavior: "set_aside", amount: 100000, day_of_month: 10 }),
    ).toBe(true);
    expect(ok({ cadence: "monthly", behavior: "refill", amount: 100000 })).toBe(true);
    expect(ok({ cadence: "weekly", behavior: "set_aside", amount: 25000, day_of_week: 6 })).toBe(
      true,
    );
    expect(
      ok({ cadence: "yearly", behavior: "set_aside", amount: 1200000, due_date: "2027-10-31" }),
    ).toBe(true);
    expect(
      ok({ cadence: "custom", behavior: "balance", amount: 600000, due_month: "2027-04-01" }),
    ).toBe(true);
    expect(ok({ cadence: "custom", behavior: "balance", amount: 60000 })).toBe(true);
    expect(
      ok({ cadence: "custom", behavior: "set_aside", amount: 300000, due_date: "2027-01-31" }),
    ).toBe(true);
    expect(
      ok({
        cadence: "custom",
        behavior: "set_aside",
        amount: 90000,
        due_date: "2027-01-15",
        repeat: { every: 3, unit: "month" },
      }),
    ).toBe(true);
    expect(
      ok({ cadence: "custom", behavior: "fill_up", amount: 80000, due_date: "2026-12-31" }),
    ).toBe(true);
  });
  it("refuses invalid combinations", () => {
    expect(ok({ cadence: "weekly", behavior: "fill_up", amount: 1000, day_of_week: 1 })).toBe(
      false,
    );
    expect(ok({ cadence: "weekly", behavior: "set_aside", amount: 1000 })).toBe(false);
    expect(ok({ cadence: "weekly", behavior: "set_aside", amount: 1000, day_of_week: 7 })).toBe(
      false,
    );
    expect(ok({ cadence: "yearly", behavior: "set_aside", amount: 1000 })).toBe(false);
    expect(
      ok({ cadence: "custom", behavior: "balance", amount: 1000, due_date: "2027-01-01" }),
    ).toBe(false);
    expect(
      ok({
        cadence: "custom",
        behavior: "balance",
        amount: 1000,
        repeat: { every: 1, unit: "month" },
      }),
    ).toBe(false);
    expect(ok({ cadence: "custom", behavior: "set_aside", amount: 1000 })).toBe(false);
    expect(ok({ cadence: "monthly", behavior: "set_aside", amount: 0 })).toBe(false);
    expect(
      ok({ cadence: "custom", behavior: "refill", amount: 1000, due_date: "2027-01-01" }),
    ).toBe(false);
    expect(
      ok({ cadence: "monthly", behavior: "set_aside", amount: 1000, due_date: "2027-01-01" }),
    ).toBe(false);
    expect(
      ok({
        cadence: "custom",
        behavior: "set_aside",
        amount: 1000,
        due_date: "2027-01-15",
        repeat: { every: 12, unit: "month" },
      }),
    ).toBe(false);
    expect(
      ok({ cadence: "yearly", behavior: "set_aside", amount: 1000, due_date: "2027-02-30" }),
    ).toBe(false);
  });
});
