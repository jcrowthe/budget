import { describe, expect, it } from "vitest";
import { evaluateAmountEntry, formatAmountEntry, signedAmount } from "../src/amount-entry";

const show = (t: string) => {
  const v = evaluateAmountEntry(t);
  return v === null ? "" : formatAmountEntry(v);
};

describe("amount entry", () => {
  it.each([
    ["12.34+5", "17.34"],
    ["100/4", "25.00"],
    ["3*2.5", "7.50"],
    ["10-2.5", "7.50"],
    ["(2+3)*2", "10.00"],
    ["1,234.5", "1,234.50"],
    ["5+", "5.00"],
    ["-5", "5.00"],
    ["2-5", "3.00"],
    [".5", "0.50"],
    ["$12", "12.00"],
    ["abc", ""],
    ["0", ""],
    ["", ""],
    ["1/0", ""],
    ["((2)", ""],
    ["2+3)", ""],
    ["0.004", ""],
  ])("%j → %j", (text, want) => expect(show(text)).toBe(want));

  it("returns milliunits", () => {
    expect(evaluateAmountEntry("12.34+5")).toBe(17340);
    expect(evaluateAmountEntry("0.01")).toBe(10);
  });
  it("signs the amount", () => {
    expect(signedAmount(17340, null)).toBe(-17340);
    expect(signedAmount(null, 5000)).toBe(5000);
    expect(signedAmount(null, null)).toBe(0);
  });
});
