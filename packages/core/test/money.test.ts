import { describe, expect, it } from "vitest";
import {
  addMilliunits,
  assertMilliunits,
  formatMoney,
  fromMilliunits,
  toMilliunits,
} from "../src/money";

describe("money", () => {
  it("parses decimals to milliunits", () => {
    expect(toMilliunits("12.34")).toBe(12340);
    expect(toMilliunits("-0.5")).toBe(-500);
    expect(toMilliunits("7")).toBe(7000);
    expect(toMilliunits("0.001")).toBe(1);
  });
  it("rejects more than 3 decimals and junk", () => {
    expect(() => toMilliunits("1.2345")).toThrow();
    expect(() => toMilliunits("abc")).toThrow();
  });
  it("formats with exactly 3 decimals", () => {
    expect(fromMilliunits(12340)).toBe("12.340");
    expect(fromMilliunits(-5)).toBe("-0.005");
  });
  it("adds integers only", () => {
    expect(addMilliunits(1000, 250, -50)).toBe(1200);
    expect(() => addMilliunits(0.5)).toThrow();
    expect(() => assertMilliunits(Number.MAX_SAFE_INTEGER + 2)).toThrow();
  });
  it("formats for display", () => {
    expect(formatMoney(12340, { currency: "USD", locale: "en-US" })).toBe("$12.34");
  });
});
