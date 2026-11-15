import { describe, expect, it } from "vitest";
import { applyAssigned, evaluateAssigned, formatAssignedInput } from "../src/assigned-edit";
import type { MonthDetail } from "../src/months";

describe("evaluateAssigned", () => {
  const cases: [string, number, number][] = [
    // ticket rows
    ["400", 0, 400000],
    ["400.00+50", 400000, 450000],
    ["+50", 400000, 450000],
    ["100.00*2", 100000, 200000],
    ["*2", 100000, 200000],
    ["x2", 100000, 200000],
    ["200.00/4", 200000, 50000],
    ["/4", 200000, 50000],
    ["50.00-10", 50000, 40000],
    ["0.00*2", 0, 0],
    ["12.345", 0, 12350],
    ["1,234.5", 0, 1234500],
    ["abc", 400000, 0],
    // negatives
    ["-10", 50000, -10000],
    ["-12.00+5", -12000, -7000],
    ["0-25", 0, -25000],
    ["-12.345", 0, -12350],
    // normalisation
    ["$1,000", 0, 1000000],
    ["2×3", 0, 6000],
    ["9÷3", 0, 3000],
    ["5−2", 0, 3000],
    [" 4 0 ", 0, 40000],
    // precedence and shapes
    ["2+3*4", 0, 14000],
    ["10/4", 0, 2500],
    ["1/3", 0, 330],
    ["2/3", 0, 670],
    [".5", 0, 500],
    ["5.", 0, 5000],
    // zero results
    ["", 0, 0],
    ["1.2.3", 0, 0],
    ["5/0", 0, 0],
    ["4+", 0, 0],
    ["1e5", 0, 0],
    ["++1", 0, 0],
  ];
  it.each(cases)("%j with %i before gives %i", (text, before, expected) => {
    expect(evaluateAssigned(text, before)).toBe(expected);
  });
});

describe("formatAssignedInput", () => {
  it.each([
    [0, "0.00"],
    [400000, "400.00"],
    [1234500, "1,234.50"],
    [-12000, "-12.00"],
    [12345, "12.35"],
  ])("%i is %j", (m, s) => {
    expect(formatAssignedInput(m)).toBe(s);
  });
});

const cat = (id: string, assigned: number, available: number) => ({
  id,
  name: id,
  sort: 0,
  hidden: false,
  assigned,
  activity: 0,
  available,
  carried: 0,
  target: null,
});
const detail = (): MonthDetail => ({
  month: "2026-11-01",
  note: null,
  ready_to_assign: 500000,
  rta_breakdown: {
    left_over_from_previous: 0,
    inflows: 600000,
    cash_overspending_previous: 0,
    assigned_in_month: -100000,
    assigned_in_future: 0,
  },
  groups: [
    {
      id: "g1",
      name: "g1",
      sort: 0,
      hidden: false,
      collapsed: false,
      assigned: 100000,
      activity: 0,
      available: 100000,
      categories: [cat("a", 100000, 100000), cat("b", 0, 0)],
    },
    {
      id: "g2",
      name: "g2",
      sort: 1,
      hidden: false,
      collapsed: false,
      assigned: 0,
      activity: 0,
      available: 0,
      categories: [cat("c", 0, 0)],
    },
  ],
  uncategorized: null,
});

describe("applyAssigned", () => {
  it("moves the category, its group and Ready to Assign", () => {
    const d = detail();
    const out = applyAssigned(d, "a", 250000);
    expect(out.groups[0]?.categories[0]).toMatchObject({ assigned: 250000, available: 250000 });
    expect(out.groups[0]).toMatchObject({ assigned: 250000, available: 250000 });
    expect(out.ready_to_assign).toBe(350000);
    expect(out.rta_breakdown.assigned_in_month).toBe(-250000);
    expect(out.groups[0]?.categories[1]).toEqual(d.groups[0]?.categories[1]);
    expect(out.groups[1]).toEqual(d.groups[1]);
    expect(d).toEqual(detail());
  });
  it("returns the input for an unknown id or no change", () => {
    const d = detail();
    expect(applyAssigned(d, "zzz", 5)).toBe(d);
    expect(applyAssigned(d, "a", 100000)).toBe(d);
  });
});
