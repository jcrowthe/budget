import { describe, expect, it } from "vitest";
import { keepPreviousInPlan } from "../src/placeholder";

// EXF-588: the second guard (the page remount is the first) against showing another plan's figures.
describe("keepPreviousInPlan", () => {
  const prev = { total: 1 };
  it("drops the previous data when it belongs to another plan", () => {
    const keep = keepPreviousInPlan<typeof prev>("Y");
    expect(keep(prev, { queryKey: ["net-worth", "X", "a"] })).toBeUndefined();
  });
  it("keeps the previous data inside one plan", () => {
    const keep = keepPreviousInPlan<typeof prev>("Y");
    expect(keep(prev, { queryKey: ["spending-breakdown", "Y", "a"] })).toBe(prev);
    expect(keep(prev, { queryKey: ["report-transactions", "Y", "a"] })).toBe(prev);
  });
  it("has nothing to keep without a previous query", () => {
    expect(keepPreviousInPlan<typeof prev>("Y")(prev)).toBeUndefined();
  });
});
