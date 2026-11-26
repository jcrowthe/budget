import { describe, expect, it } from "vitest";
import { costBars } from "./costToBeMe";

describe("costBars", () => {
  it("income below the targets: a full deficit bar and income ÷ targets", () => {
    expect(costBars(603340, 500000)).toEqual({ deficit: true, targetsPct: 100, incomePct: 82.872 });
  });
  it("income above the targets: targets ÷ income and a full income bar", () => {
    expect(costBars(603340, 1000000)).toEqual({
      deficit: false,
      targetsPct: 60.334,
      incomePct: 100,
    });
  });
  it("no targets: an empty targets bar", () => {
    expect(costBars(0, 1000)).toEqual({ deficit: false, targetsPct: 0, incomePct: 100 });
  });
  it("equal values: both full, no deficit", () => {
    expect(costBars(5000, 5000)).toEqual({ deficit: false, targetsPct: 100, incomePct: 100 });
  });
});
