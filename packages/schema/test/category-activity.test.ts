import { describe, expect, it } from "vitest";
import { activityMoreText, activityTitle } from "../src/category-activity";

const rows = (n: number) => Array.from({ length: n }, () => ({}) as never);

describe("category activity text", () => {
  it("says nothing when no row is cut", () => {
    expect(activityMoreText({ total_count: 0, transactions: [] })).toBeNull();
    expect(activityMoreText({ total_count: 2, transactions: rows(2) })).toBeNull();
  });
  it("counts the rows not shown", () => {
    expect(activityMoreText({ total_count: 3, transactions: rows(2) })).toBe(
      "1 more transaction not shown.",
    );
    expect(activityMoreText({ total_count: 503, transactions: rows(500) })).toBe(
      "3 more transactions not shown.",
    );
  });
  it("words the button title", () => {
    expect(activityTitle("−$60.00")).toBe("(−$60.00) View this category's monthly activity.");
  });
});
