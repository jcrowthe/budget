import { describe, expect, it } from "vitest";
import { parseAmountInput } from "../src/amount-input";

describe("parseAmountInput", () => {
  it.each([
    ["250", 250000],
    ["1234.56", 1234560],
    ["-20", -20000],
    ["0", 0],
    ["-0", 0],
    ["1,234.56", 1234560],
    ["$1,234", 1234000],
    ["-$20", -20000],
    ["$-20", -20000],
    [" 12.5 ", 12500],
    [".5", 500],
  ])("reads %s", (text, want) => {
    const got = parseAmountInput(text);
    expect(got).toBe(want);
    expect(Object.is(got, -0)).toBe(false);
  });

  it.each([
    "abc",
    "10+5",
    "1.234",
    "12,34",
    "1,2345",
    "--5",
    "$",
    "-",
    "",
    "1e3",
    "5.",
    "$$5",
    "5-",
    "99999999999999999",
  ])("refuses %j", (text) => {
    expect(parseAmountInput(text)).toBeNull();
  });
});
