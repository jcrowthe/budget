import { describe, expect, it } from "vitest";
import { categoryMonth, monthTotals, viewTotals } from "../src/month-totals";
import type { MonthCategoryDetail, MonthDetail } from "../src/months";

const cat = (id: string, o: Partial<MonthCategoryDetail> = {}): MonthCategoryDetail => ({
  id,
  name: id,
  sort: 0,
  hidden: false,
  kind: null,
  account_id: null,
  cash_spending: 0,
  credit_spending: 0,
  overspent: null,
  state: "ok" as const,
  assigned: 0,
  activity: 0,
  available: 0,
  carried: 0,
  target: null,
  note: null,
  target_snoozed: false,
  upcoming: 0,
  upcoming_count: 0,
  available_after_upcoming: 0,
  paired_account_id: null,
  paid_this_month: 0,
  payment: null,
  ...o,
});

const detail = (): MonthDetail => ({
  month: "2026-11-01",
  note: null,
  ready_to_assign: 0,
  rta_breakdown: {
    left_over_from_previous: 0,
    inflows: 0,
    cash_overspending_previous: 0,
    assigned_in_month: 0,
    assigned_in_future: 0,
  },
  uncategorized: null,
  groups: [
    {
      id: "g1",
      name: "G1",
      sort: 0,
      hidden: false,
      kind: null,
      collapsed: false,
      assigned: 0,
      activity: 0,
      available: 0,
      categories: [
        cat("a", {
          carried: 70000,
          assigned: 100000,
          activity: -30000,
          available: 140000,
          note: "n",
        }),
        cat("b", { assigned: 50000, available: 50000 }),
        cat("h", { hidden: true, assigned: 9000, available: 9000 }),
      ],
    },
    {
      id: "g2",
      name: "G2",
      sort: 1,
      hidden: true,
      kind: null,
      collapsed: false,
      assigned: 0,
      activity: 0,
      available: 0,
      categories: [cat("c", { assigned: 7000, available: 7000 })],
    },
  ],
});

describe("monthTotals", () => {
  it("leaves hidden categories and hidden groups out without ids", () => {
    expect(monthTotals(detail())).toEqual({
      leftover: 70000,
      assigned: 150000,
      activity: -30000,
      available: 190000,
    });
  });

  it("counts exactly the listed ids, hidden or not", () => {
    expect(monthTotals(detail(), ["h", "c"])).toEqual({
      leftover: 0,
      assigned: 16000,
      activity: 0,
      available: 16000,
    });
  });

  it("keeps available = leftover + assigned + activity", () => {
    const t = monthTotals(detail(), ["a", "b"]);
    expect(t.available).toBe(t.leftover + t.assigned + t.activity);
  });
});

describe("categoryMonth", () => {
  it("maps carried to leftover and has no credit activity", () => {
    expect(categoryMonth(detail(), "a")).toEqual({
      leftover: 70000,
      assigned: 100000,
      cash_activity: -30000,
      credit_activity: 0,
      available: 140000,
      note: "n",
      payment: null,
      upcoming: 0,
      upcoming_count: 0,
      available_after_upcoming: 0,
    });
  });
  it("carries the upcoming figures (EXF-505)", () => {
    const d = detail();
    const c = d.groups[0]?.categories.find((x) => x.id === "a");
    if (c)
      Object.assign(c, { upcoming: -40000, upcoming_count: 2, available_after_upcoming: 100000 });
    expect(categoryMonth(d, "a")).toMatchObject({
      upcoming: -40000,
      upcoming_count: 2,
      available_after_upcoming: 100000,
    });
  });
  it("splits activity into cash and credit (EXF-535)", () => {
    const d = detail();
    const c = d.groups[0]?.categories.find((x) => x.id === "a");
    if (c) Object.assign(c, { activity: -70000, credit_spending: -40000 });
    expect(categoryMonth(d, "a")).toMatchObject({ cash_activity: -30000, credit_activity: -40000 });
  });
  it("is null for an unknown id", () => {
    expect(categoryMonth(detail(), "zz")).toBeNull();
  });
});

describe("viewTotals", () => {
  it("totals only what the view shows", () => {
    expect(viewTotals(detail(), "money_available")).toEqual({
      leftover: 70000,
      assigned: 150000,
      activity: -30000,
      available: 190000,
    });
    expect(viewTotals(detail(), "overspent")).toEqual({
      leftover: 0,
      assigned: 0,
      activity: 0,
      available: 0,
    });
    expect(viewTotals(detail(), "all")).toEqual(monthTotals(detail()));
  });
});
