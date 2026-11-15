import { describe, expect, it } from "vitest";
import { BudgetCreate, BudgetUpdate } from "../src/budgets";
import { Month } from "../src/common/dates";
import { Milliunits } from "../src/common/money";

describe("schemas", () => {
  it("trims and bounds plan names", () => {
    expect(BudgetCreate.parse({ name: "  A  " }).name).toBe("A");
    expect(BudgetCreate.safeParse({ name: "   " }).success).toBe(false);
    expect(BudgetCreate.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(BudgetUpdate.parse({})).toEqual({});
  });
  it("month is a first day", () => {
    expect(Month.safeParse("2026-11-01").success).toBe(true);
    expect(Month.safeParse("2026-11-15").success).toBe(false);
  });
  it("money is an integer", () => {
    expect(Milliunits.safeParse(1000).success).toBe(true);
    expect(Milliunits.safeParse(1.5).success).toBe(false);
  });
});
