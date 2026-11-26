import { describe, expect, it } from "vitest";
import {
  BUILTIN_VIEW_KEYS,
  CustomViewCreate,
  CustomViewUpdate,
  customViewEmptyText,
  editedViewCategoryIds,
  isBuiltinViewKey,
} from "../src/custom-views";
import { monthTotals, viewTotals } from "../src/month-totals";
import type { MonthCategoryDetail, MonthDetail } from "../src/months";
import {
  type CustomViewScope,
  inView,
  isCustomView,
  type PlanView,
  viewCategories,
  viewDetail,
} from "../src/plan-views";

const cat = (id: string, o: Partial<MonthCategoryDetail> = {}): MonthCategoryDetail =>
  ({
    id,
    name: id,
    sort: 0,
    hidden: false,
    kind: null,
    account_id: null,
    cash_spending: 0,
    credit_spending: 0,
    overspent: null,
    state: "ok",
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
  }) as MonthCategoryDetail;

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
      cat("rent", { assigned: 100, activity: -30, available: 70, carried: 0 }),
      cat("phone", { assigned: 20, activity: -25, available: -5, carried: 0 }),
      cat("hid", { hidden: true, assigned: 7, available: 7 }),
      cat("food", { assigned: 50, available: 50, carried: 1 }),
    ]),
    group("g2", [cat("fun", { assigned: 9, available: 9 })]),
    group("g3", [cat("inhidden", { assigned: 3, available: 3 })], true),
  ],
});

const scope = (...category_ids: string[]): CustomViewScope => ({
  id: "v",
  name: "V",
  category_ids,
});

describe("custom view scope", () => {
  it("keeps only the members, in grid order, grouped, with subtotals over them", () => {
    const d = viewDetail(detail(), scope("phone", "fun", "rent"));
    expect(d.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(d.groups[0]?.categories.map((c) => c.id)).toEqual(["rent", "phone"]);
    expect(d.groups[0]).toMatchObject({ assigned: 120, activity: -55, available: 65 });
    expect(d.groups[1]).toMatchObject({ assigned: 9, activity: 0, available: 9 });
    expect(d.uncategorized).toBeNull();
  });
  it("leaves out a hidden member and a member of a hidden group", () => {
    const s = scope("hid", "inhidden", "food");
    expect(viewCategories(detail(), s).map((c) => c.id)).toEqual(["food"]);
    expect(viewDetail(detail(), s).groups.map((g) => g.id)).toEqual(["g1"]);
  });
  it("an empty set shows no groups", () => {
    expect(viewDetail(detail(), scope()).groups).toEqual([]);
    expect(viewCategories(detail(), scope())).toEqual([]);
  });
  it("viewTotals equals monthTotals over the visible members", () => {
    expect(viewTotals(detail(), scope("rent", "food", "hid"))).toEqual(
      monthTotals(detail(), ["rent", "food"]),
    );
    expect(viewTotals(detail(), scope("rent", "food"))).toMatchObject({
      assigned: 150,
      activity: -30,
      available: 120,
      leftover: 1,
    });
  });
  it("inView follows membership", () => {
    const c = cat("rent");
    expect(inView(c, scope("rent"))).toBe(true);
    expect(inView(c, scope("other"))).toBe(false);
  });
  it("isCustomView tells a scope from a built-in", () => {
    expect(isCustomView(scope())).toBe(true);
    expect(isCustomView("all")).toBe(false);
  });
});

describe("built-in views are unchanged", () => {
  it.each([
    "all",
    "overspent",
    "underfunded",
    "overfunded",
    "money_available",
    "snoozed",
  ] as PlanView[])("%s", (v) => {
    const d = detail();
    const expected = d.groups
      .filter((g) => !g.hidden)
      .flatMap((g) => g.categories.filter((c) => !c.hidden && inView(c, v)))
      .map((c) => c.id);
    expect(viewCategories(d, v).map((c) => c.id)).toEqual(expected);
  });
  it("overspent is Available below zero", () => {
    expect(viewCategories(detail(), "overspent").map((c) => c.id)).toEqual(["phone"]);
  });
});

describe("editedViewCategoryIds", () => {
  it("keeps stored ids that are not shown, adds the checked ones, deduplicates", () => {
    expect(
      editedViewCategoryIds(["hid", "rent", "gone"], ["rent", "food", "gone"], ["food", "rent"]),
    ).toEqual(["hid", "food", "rent"]);
    expect(editedViewCategoryIds(["a", "a", "h"], ["a"], ["a", "a"])).toEqual(["h", "a"]);
  });
});

describe("custom view validation", () => {
  it("a blank name is required", () => {
    const r = CustomViewCreate.safeParse({ name: "  " });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("The view name is required.");
  });
  it("101 characters fail; the name is trimmed; categories default to []", () => {
    expect(CustomViewCreate.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(CustomViewCreate.parse({ name: "  Bills " })).toEqual({
      name: "Bills",
      category_ids: [],
    });
  });
  it("caps the categories at 500", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
    expect(CustomViewCreate.safeParse({ name: "a", category_ids: ids(500) }).success).toBe(true);
    expect(CustomViewCreate.safeParse({ name: "a", category_ids: ids(501) }).success).toBe(false);
  });
  it("an update needs name or category_ids", () => {
    const r = CustomViewUpdate.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Give name or category_ids");
    expect(CustomViewUpdate.safeParse({ category_ids: [] }).success).toBe(true);
  });
  it("built-in keys", () => {
    expect(BUILTIN_VIEW_KEYS).toEqual(["underfunded", "overfunded", "money_available", "snoozed"]);
    expect(isBuiltinViewKey("snoozed")).toBe(true);
    expect(isBuiltinViewKey("all")).toBe(false);
  });
  it("the empty text", () => {
    expect(customViewEmptyText("D1 View")).toBe("There are no categories selected for D1 View.");
  });
});
