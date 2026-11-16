import { describe, expect, it } from "vitest";
import { plaidToMilliunits } from "../src/plaid/amounts";

describe("plaidToMilliunits", () => {
  it.each([
    [110.01, 110010],
    [0.3, 300],
    [0.1 + 0.2, 300],
    [-0.3, -300],
    [-12.34, -12340],
    [1.0005, 1001],
    [-1.0005, -1001],
    [1e-7, 0],
    [123456789.12, 123456789120],
  ])("%s -> %s", (n, milli) => {
    expect(plaidToMilliunits(n)).toBe(milli);
  });
  it("never returns -0", () => {
    expect(Object.is(plaidToMilliunits(-0.0001), 0)).toBe(true);
  });
  it("null and undefined stay null; a non-finite number throws", () => {
    expect(plaidToMilliunits(null)).toBeNull();
    expect(plaidToMilliunits(undefined)).toBeNull();
    expect(() => plaidToMilliunits(Number.NaN)).toThrow(RangeError);
  });
});
