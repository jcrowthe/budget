import { describe, expect, it } from "vitest";
import { transferCategoryRule, transferPayeeLabel, transferPayeeName } from "../src/transfers";

const on = { on_budget: true };
const off = { on_budget: false };

describe("transferCategoryRule", () => {
  it.each([
    ["on-plan, plain row", on, null, "category"],
    ["tracking, plain row", off, null, "none"],
    ["on-plan to on-plan", on, on, "not_needed"],
    ["on-plan to tracking", on, off, "category"],
    ["tracking to on-plan", off, on, "none"],
    ["tracking to tracking", off, off, "none"],
  ] as const)("%s", (_n, side, other, rule) => {
    expect(transferCategoryRule(side, other)).toBe(rule);
  });
});

describe("transfer labels", () => {
  it("spells the payee name and the picker label", () => {
    expect(transferPayeeName("Savings")).toBe("Transfer : Savings");
    expect(transferPayeeLabel("Savings")).toBe("To/From Savings");
  });
});
