import { describe, expect, it } from "vitest";
import type { MonthCategoryDetail, MonthDetail } from "../src/months";
import {
  inView,
  overspentCount,
  type PlanView,
  viewCategories,
  viewDetail,
} from "../src/plan-views";
import type { CategoryTargetMonth } from "../src/targets";

const target = (o: Partial<CategoryTargetMonth> = {}): CategoryTargetMonth => ({
  definition: {
    cadence: "monthly",
    behavior: "set_aside",
    amount: 100000,
    day_of_week: null,
    day_of_month: null,
    due_date: null,
    due_month: null,
    repeat: null,
    created_on: "2026-11-01",
  },
  status: "underfunded",
  needed_this_month: 100000,
  amount_this_month: 100000,
  funded: 0,
  to_go_this_month: 0,
  overall_to_go: 0,
  overfunded: 0,
  percent: 0,
  due_this_month: true,
  period_due_date: null,
  ...o,
});

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
  payment: null,
  ...o,
});

const group = (id: string, categories: MonthCategoryDetail[], hidden = false) => ({
  id,
  name: id,
  sort: 0,
  hidden,
  kind: null,
  collapsed: false,
  assigned: categories.reduce((n, c) => n + c.assigned, 0),
  activity: categories.reduce((n, c) => n + c.activity, 0),
  available: categories.reduce((n, c) => n + c.available, 0),
  categories,
});

const detail = (): MonthDetail => ({
  month: "2026-11-01",
  note: null,
  ready_to_assign: 5,
  rta_breakdown: {
    left_over_from_previous: 0,
    inflows: 0,
    cash_overspending_previous: 0,
    assigned_in_month: 0,
    assigned_in_future: 0,
  },
  uncategorized: { activity: 0, available: 0 },
  groups: [
    group("g1", [
      cat("over", { assigned: 10000, activity: -60000, available: -50000 }),
      cat("under", {
        assigned: 40000,
        available: 40000,
        target: target({ to_go_this_month: 60000 }),
      }),
      cat("snz", {
        assigned: 40000,
        available: 40000,
        target: target({ status: "snoozed", to_go_this_month: 60000 }),
        target_snoozed: true,
      }),
      cat("overf", {
        assigned: 150000,
        available: 150000,
        target: target({ status: "funded", overfunded: 50000 }),
      }),
      cat("zero"),
      cat("hid", { hidden: true, available: -1000 }),
    ]),
    group("g2", [cat("plain", { assigned: 25000, available: 25000 })]),
    group("g3", [cat("x", { available: -9000 })], true),
  ],
});

const ids = (v: PlanView) => viewCategories(detail(), v).map((c) => c.id);

describe("plan views", () => {
  it("all is every visible category", () => {
    expect(ids("all")).toEqual(["over", "under", "snz", "overf", "zero", "plain"]);
  });
  it("overspent: Available below zero, hidden left out", () => {
    expect(ids("overspent")).toEqual(["over"]);
    expect(overspentCount(detail())).toBe(1);
  });
  it("underfunded: overspent or an active target with a gap; a snoozed target counts as none", () => {
    expect(ids("underfunded")).toEqual(["over", "under"]);
  });
  it("underfunded: EXF-1000 an upcoming shortfall counts, with or without a larger target gap", () => {
    const d = detail();
    const cats = d.groups[1]?.categories ?? [];
    cats.push(
      // no target, Available 30 and -40 upcoming: short by 10
      cat("short", { available: 30000, upcoming: -40000, upcoming_count: 2 }),
      // covered by Available: not short
      cat("covered", { available: 50000, upcoming: -40000, upcoming_count: 2 }),
      // target to-go 60 beats the shortfall of 10, still in
      cat("both", {
        available: 30000,
        upcoming: -40000,
        upcoming_count: 2,
        target: target({ to_go_this_month: 60000 }),
      }),
      // a payment category keeps its own rule
      cat("card", {
        available: 30000,
        upcoming: -40000,
        payment: {} as MonthCategoryDetail["payment"],
      }),
    );
    expect(viewCategories(d, "underfunded").map((c) => c.id)).toEqual([
      "over",
      "under",
      "short",
      "both",
    ]);
  });
  it("overfunded: an active target with more than it needs", () => {
    expect(ids("overfunded")).toEqual(["overf"]);
  });
  it("money available: Available above zero", () => {
    expect(ids("money_available")).toEqual(["under", "snz", "overf", "plain"]);
  });
  it("snoozed", () => {
    expect(ids("snoozed")).toEqual(["snz"]);
    expect(inView(cat("a"), "snoozed")).toBe(false);
  });
  it("viewDetail drops empty groups and re-sums subtotals over the visible categories", () => {
    const d = viewDetail(detail(), "overspent");
    expect(d.groups.map((g) => g.id)).toEqual(["g1"]);
    expect(d.groups[0]).toMatchObject({ assigned: 10000, activity: -60000, available: -50000 });
    expect(d.uncategorized).toBeNull();
    expect(d.ready_to_assign).toBe(5);
  });
  it("EXF-500: a group shown 655 / -110 / 870 in All shows 0 / -50 / -50 in Overspent", () => {
    const d: MonthDetail = {
      ...detail(),
      groups: [
        group("g", [
          cat("a", { assigned: 0, activity: -50000, available: -50000 }),
          cat("b", { assigned: 655000, activity: -60000, available: 920000 }),
        ]),
      ],
    };
    const g = d.groups[0];
    if (g) Object.assign(g, { assigned: 655000, activity: -110000, available: 870000 });
    expect(viewDetail(d, "all").groups[0]).toMatchObject({ assigned: 655000, available: 870000 });
    expect(viewDetail(d, "overspent").groups[0]).toMatchObject({
      assigned: 0,
      activity: -50000,
      available: -50000,
    });
  });
  it("all returns the same object", () => {
    const d = detail();
    expect(viewDetail(d, "all")).toBe(d);
  });
});
