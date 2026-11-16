import { describe, expect, it } from "vitest";
import {
  type AutoAssignInput,
  type AutoAssignStrategy,
  autoAssignHeight,
  autoAssignOptions,
  autoAssignPreview,
  autoAssignResult,
  hiddenAmounts,
  historyFigures,
  ORDINARY_SKIPS,
  PAYMENT_SKIPS,
} from "../src/auto-assign";
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

const input = (o: Partial<AutoAssignInput> = {}): AutoAssignInput => ({
  id: "c",
  assigned: 0,
  carried: 0,
  activity: 0,
  target: null,
  last_assigned: 0,
  last_spent: 0,
  average_assigned: 0,
  average_spent: 0,
  last_paid: 0,
  average_paid: 0,
  payment_underfunded: 0,
  payment: false,
  ...o,
});

// December of the first worked example: Nov assigned 100 and spent 30, leftover 70, target 100 a month.
const dec = (assigned: number, to_go: number): AutoAssignInput =>
  input({
    assigned,
    carried: 70000,
    target: target({ to_go_this_month: to_go }),
    last_assigned: 100000,
    last_spent: 30000,
    average_assigned: 100000,
    average_spent: 30000,
  });

const run = (c: AutoAssignInput, s: AutoAssignStrategy) => autoAssignResult(c, s);

describe("Auto-Assign worked examples", () => {
  it("December previews", () => {
    expect(autoAssignPreview([dec(0, 100000)])).toEqual({
      category_count: 1,
      underfunded: 100000,
      assigned_last_month: 100000,
      spent_last_month: 30000,
      average_assigned: 100000,
      average_spent: 30000,
      paid_last_month: 0,
      average_paid: 0,
      reduce_overfunding: 0,
      reset_available: 0,
      reset_assigned: 0,
    });
  });

  it("the click chain, each from the previous result", () => {
    // Spent Last Month: assigned 30.00, available 70 + 30 = 100.00
    expect(run(dec(0, 100000), "spent_last_month")).toBe(30000);
    // Assigned Last Month: 100.00, available 170.00
    expect(run(dec(30000, 70000), "assigned_last_month")).toBe(100000);
    expect(run(dec(100000, 0), "average_spent")).toBe(30000);
    expect(run(dec(30000, 70000), "average_assigned")).toBe(100000);
    // Reset Available: -(leftover + activity) = -70.00, available 0
    expect(run(dec(100000, 0), "reset_available")).toBe(-70000);
    expect(run(dec(-70000, 100000), "reset_assigned")).toBe(0);
    expect(run(dec(0, 100000), "underfunded")).toBe(100000);
  });

  it("Underfunded adds the gap: from 30.00 the preview is 70.00 and the click gives 100.00", () => {
    const c = dec(30000, 70000);
    expect(autoAssignPreview([c]).underfunded).toBe(70000);
    expect(run(c, "underfunded")).toBe(100000);
  });

  it("Reduce Overfunding", () => {
    const a = input({ assigned: 150000, target: target({ overfunded: 50000 }) });
    expect(autoAssignPreview([a]).reduce_overfunding).toBe(50000);
    expect(run(a, "reduce_overfunding")).toBe(100000);
    const b = input({ assigned: 250000, target: target({ overfunded: 150000 }) });
    expect(autoAssignPreview([b]).reduce_overfunding).toBe(150000);
    const bal = input({ assigned: 150000, target: target({ overfunded: 46660 }) });
    expect(autoAssignPreview([bal]).reduce_overfunding).toBe(46660);
    expect(run(bal, "reduce_overfunding")).toBe(103340);
    const refill = input({ assigned: 0, carried: 150000, target: target({ overfunded: 50000 }) });
    expect(autoAssignPreview([refill]).reduce_overfunding).toBe(0);
  });

  it("a snoozed target counts as no target", () => {
    const s = input({
      assigned: 150000,
      target: target({ status: "snoozed", to_go_this_month: 60000, overfunded: 50000 }),
    });
    const p = autoAssignPreview([s]);
    expect(p.underfunded).toBe(0);
    expect(p.reduce_overfunding).toBe(0);
    expect(run(s, "underfunded")).toBe(150000);
  });

  it("multi-select sums the gaps and each category gets its own", () => {
    const cs = [
      input({ id: "a", target: target({ to_go_this_month: 100000 }) }),
      input({ id: "b", target: target({ to_go_this_month: 100000 }) }),
    ];
    expect(autoAssignPreview(cs).underfunded).toBe(200000);
    expect(cs.map((c) => run(c, "underfunded"))).toEqual([100000, 100000]);
  });
});

describe("historyFigures", () => {
  const f = (month: string, assigned: number, spent = 0, paid = 0) => ({
    month,
    assigned,
    activity: -spent,
    paid,
  });
  it("Jan, refill category assigned Nov 100 / Dec 30, spent 30 / 0", () => {
    const h = historyFigures(
      "2027-01-01",
      [f("2026-11-01", 100000, 30000), f("2026-12-01", 30000)],
      "2026-11-01",
    );
    expect(h.average_assigned).toBe(65000);
    expect(h.average_spent).toBe(15000);
    expect(h.last_assigned).toBe(30000);
    expect(h.last_spent).toBe(0);
  });
  it("weekly: 50 / 0 assigned, 10 / 0 spent", () => {
    const h = historyFigures(
      "2027-01-01",
      [f("2026-11-01", 50000, 10000), f("2026-12-01", 0)],
      "2026-11-01",
    );
    expect(h.average_assigned).toBe(25000);
    expect(h.average_spent).toBe(5000);
  });
  it("a month with nothing counts as zero", () => {
    const h = historyFigures("2027-01-01", [f("2026-11-01", 90000)], "2026-11-01");
    expect(h.average_assigned).toBe(45000);
    expect(h.last_assigned).toBe(0);
  });
  it("only the last 12 months are averaged", () => {
    const months: ReturnType<typeof f>[] = [];
    for (let i = 0; i < 14; i++) {
      const y = 2025 + Math.floor(i / 12);
      const m = (i % 12) + 1;
      months.push(f(`${y}-${String(m).padStart(2, "0")}-01`, i < 2 ? 1_000_000 : 12000));
    }
    // viewing 2026-03: previous 2025-01 .. 2026-02; the first two (Jan, Feb 2025) fall outside 2025-03..2026-02
    const h = historyFigures("2026-03-01", months, "2025-01-01");
    expect(h.average_assigned).toBe(12000);
  });
  it("a category whose first month is the one in view averages 0", () => {
    const h = historyFigures("2026-11-01", [f("2026-10-01", 50000)], "2026-11-01");
    expect(h.average_assigned).toBe(0);
    expect(h.average_spent).toBe(0);
  });
  it("rounds to the cent, halves away from zero", () => {
    expect(
      historyFigures("2027-01-01", [f("2026-11-01", 10), f("2026-12-01", 10)], "2026-11-01")
        .average_assigned,
    ).toBe(10);
    expect(historyFigures("2027-01-01", [f("2026-11-01", 50)], "2026-11-01").average_assigned).toBe(
      30,
    );
  });
});

describe("autoAssignOptions", () => {
  const p = autoAssignPreview([dec(0, 100000)]);
  it("order, groups and plural labels", () => {
    const o = autoAssignOptions({ ...p, reduce_overfunding: 5000 }, "many");
    expect(o.map((x) => [x.group, x.label])).toEqual([
      [1, "Underfunded"],
      [2, "Assigned Last Month"],
      [2, "Spent Last Month"],
      [2, "Average Assigned"],
      [2, "Average Spent"],
      [3, "Reduce Overfunding"],
      [3, "Reset Available Amounts"],
      [3, "Reset Assigned Amounts"],
    ]);
  });
  it("singular labels for one", () => {
    const one = autoAssignOptions(p, "one").map((x) => x.label);
    expect(one).toContain("Reset Available Amount");
    expect(one).toContain("Reset Assigned Amount");
  });
  it("EXF-624 (reversed after the source was seen): Underfunded shows at 0 for many, hides for one and payment; Reduce Overfunding hides at 0 everywhere", () => {
    const zero = { ...p, underfunded: 0, reduce_overfunding: 0 };
    expect(autoAssignOptions(zero, "many").map((x) => x.label)).toContain("Underfunded");
    for (const scope of ["one", "payment"] as const) {
      expect(autoAssignOptions(zero, scope).map((x) => x.label)).not.toContain("Underfunded");
    }
    for (const scope of ["many", "one", "payment"] as const) {
      expect(autoAssignOptions(zero, scope).map((x) => x.label)).not.toContain(
        "Reduce Overfunding",
      );
    }
    const shown = autoAssignOptions({ ...p, reduce_overfunding: 5000 }, "many").map((x) => x.label);
    expect(shown).toContain("Underfunded");
    expect(shown).toContain("Reduce Overfunding");
  });
  it("`hidden` decides the rows, the preview decides the amounts", () => {
    const blank = { ...p, underfunded: 0, reduce_overfunding: 0 };
    const o = autoAssignOptions(blank, "many", { underfunded: 5, reduce_overfunding: 0 });
    expect(o.map((x) => x.label)).toContain("Underfunded");
    expect(o.find((x) => x.strategy === "underfunded")?.amount).toBe(0);
  });
  it("the payment list: Underfunded, Assigned Last Month, Paid Last Month, Average Assigned, Average Paid, resets", () => {
    const o = autoAssignOptions(p, "payment");
    expect(o.map((x) => [x.group, x.label])).toEqual([
      [1, "Underfunded"],
      [2, "Assigned Last Month"],
      [2, "Paid Last Month"],
      [2, "Average Assigned"],
      [2, "Average Paid"],
      [3, "Reset Available Amount"],
      [3, "Reset Assigned Amount"],
    ]);
    expect(o.find((x) => x.strategy === "paid_last_month")?.title).toBeNull();
    expect(o.find((x) => x.strategy === "average_paid")?.title).toBe(
      "Assign your historical average paid to this card.",
    );
  });
  it("autoAssignHeight is the source's 352 / 304 / 386", () => {
    expect(autoAssignHeight(autoAssignOptions(p, "many"))).toBe(352); // 7 rows, 3 groups
    expect(autoAssignHeight(autoAssignOptions({ ...p, underfunded: 0 }, "one"))).toBe(304); // 6 rows, 2 groups
    expect(autoAssignHeight(autoAssignOptions({ ...p, reduce_overfunding: 5 }, "many"))).toBe(386); // 8 rows
  });
  it("titles", () => {
    const o = autoAssignOptions(p, "many");
    expect(o.find((x) => x.strategy === "underfunded")?.title).toBeNull();
    expect(o.find((x) => x.strategy === "reset_assigned")?.title).toBe(
      "Reset all assigned amounts for this month, in case you want a do-over.",
    );
    expect(o.find((x) => x.strategy === "average_spent")?.title).toBe(
      "Assign your historical average spent. Though you're above average in my book.",
    );
  });
});

describe("EXF-532: credit card payment categories", () => {
  const pay = (o: Partial<AutoAssignInput> = {}) =>
    input({
      payment: true,
      assigned: 5000,
      last_assigned: 7000,
      last_spent: 9000,
      average_spent: 9000,
      ...o,
    });
  it("takes part in Assigned Last Month and Reset like any category", () => {
    expect(autoAssignResult(pay(), "assigned_last_month")).toBe(7000);
    expect(autoAssignResult(pay({ carried: 1000, activity: 500 }), "reset_available")).toBe(-1500);
    expect(autoAssignResult(pay(), "reset_assigned")).toBe(0);
  });
  it("keeps Assigned under Reduce Overfunding, Spent Last Month and Average Spent", () => {
    for (const s of PAYMENT_SKIPS) expect(autoAssignResult(pay(), s)).toBe(5000);
  });
  it("is left out of the sums that read targets or spending", () => {
    const p = autoAssignPreview([pay(), input({ last_spent: 100, average_spent: 40 })]);
    expect(p.spent_last_month).toBe(100);
    expect(p.average_spent).toBe(40);
    expect(p.assigned_last_month).toBe(7000);
    expect(p.category_count).toBe(2);
  });
});

describe("EXF-537: payment strategies and hidden amounts", () => {
  const pay = (o: Partial<AutoAssignInput> = {}) =>
    input({ payment: true, assigned: 5000, last_paid: 100000, average_paid: 40000, ...o });
  it("Underfunded adds the card's Total Underfunded; 0 when it is not alone", () => {
    expect(autoAssignResult(pay({ payment_underfunded: 1200000 }), "underfunded")).toBe(1205000);
    expect(autoAssignResult(pay(), "underfunded")).toBe(5000);
  });
  it("Paid Last Month and Average Paid change only payment categories", () => {
    expect(autoAssignResult(pay(), "paid_last_month")).toBe(100000);
    expect(autoAssignResult(pay(), "average_paid")).toBe(40000);
    const o = input({ assigned: 7, last_paid: 9, average_paid: 9 });
    expect(autoAssignResult(o, "paid_last_month")).toBe(7);
    expect(autoAssignResult(o, "average_paid")).toBe(7);
    expect(ORDINARY_SKIPS).toEqual(["paid_last_month", "average_paid"]);
  });
  it("preview: paid sums over payment categories; underfunded counts the lone card", () => {
    const p = autoAssignPreview([pay({ payment_underfunded: 300 }), dec(0, 100000)]);
    expect(p.paid_last_month).toBe(100000);
    expect(p.average_paid).toBe(40000);
    expect(p.underfunded).toBe(100300);
  });
  it("hiddenAmounts", () => {
    const t = target({ to_go_this_month: 70, overfunded: 30 });
    expect(
      hiddenAmounts([
        { assigned: 50, target: t, payment: false, payment_underfunded: 0 },
        { assigned: 0, target: null, payment: true, payment_underfunded: 9 },
      ]),
    ).toEqual({ underfunded: 79, reduce_overfunding: 30 });
  });
  it("history figures carry paid", () => {
    const m = (month: string, paid: number) => ({ month, assigned: 0, activity: 0, paid });
    const h = historyFigures(
      "2027-01-01",
      [m("2026-11-01", 100000), m("2026-12-01", 30000)],
      "2026-11-01",
    );
    expect(h.last_paid).toBe(30000);
    expect(h.average_paid).toBe(65000);
  });
});
