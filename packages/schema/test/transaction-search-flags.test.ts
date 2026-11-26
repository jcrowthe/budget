import { describe, expect, it } from "vitest";
import { registerCsv } from "../src/register-export";
import { flagOptions, formatToken, parseSearch } from "../src/transaction-search";
import type { PlanTransaction } from "../src/transactions";

const ctx = { dateFormat: "MM/DD/YYYY", today: "2026-11-26" };

describe("search by the plan's flag names (EXF-480)", () => {
  it("Flag: Tax resolves to red, and Flag: Red still does", () => {
    const c = { ...ctx, flagNames: { red: "Tax" } };
    expect(parseSearch("Flag: Tax", c).tokens).toEqual([{ type: "flag", color: "red" }]);
    expect(parseSearch("Flag: Red", c).tokens).toEqual([{ type: "flag", color: "red" }]);
    expect(parseSearch("Flag: None", c).tokens).toEqual([{ type: "flag", color: null }]);
  });
  it("duplicates resolve to the first colour; Red named Blue is red", () => {
    expect(
      parseSearch("Flag: Bills", { ...ctx, flagNames: { green: "Bills", orange: "Bills" } }).tokens,
    ).toEqual([{ type: "flag", color: "orange" }]);
    expect(parseSearch("Flag: Blue", { ...ctx, flagNames: { red: "Blue" } }).tokens).toEqual([
      { type: "flag", color: "red" },
    ]);
  });
  it("the error lists None and the plan's labels", () => {
    const r = parseSearch("Flag: Nope", { ...ctx, flagNames: { red: "Tax" } });
    expect(r.invalid[0]?.reason).toBe(
      "Flag must be one of None, Tax, Orange, Yellow, Green, Blue, Purple",
    );
  });
  it("formatToken writes the plan's label", () => {
    expect(formatToken({ type: "flag", color: "red" }, "MM/DD/YYYY", { red: "Tax" })).toBe(
      "Flag: Tax",
    );
    expect(formatToken({ type: "flag", color: "red" }, "MM/DD/YYYY")).toBe("Flag: Red");
  });
  it("flagOptions lists None and the labels in colour order", () => {
    expect(flagOptions({ blue: "Bills" })).toEqual([
      "None",
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Bills",
      "Purple",
    ]);
  });
});

describe("registerCsv flag label", () => {
  const row = {
    account_name: "ZZ-TEST",
    flag_color: "red",
    date: "2026-11-01",
    payee_name: "P",
    category_group_name: "G",
    category_name: "C",
    inflow_to_ready_to_assign: false,
    memo: null,
    amount: -1000,
    cleared: "cleared",
    subtransactions: [],
  } as unknown as PlanTransaction;
  it("writes the given label in the Flag column, and the colour name by default", () => {
    expect(registerCsv([row], undefined, () => "Tax")).toContain('"Tax"');
    expect(registerCsv([row])).toContain("Red");
    expect(registerCsv([row])).not.toContain("Tax");
  });
});
