import { describe, expect, it } from "vitest";
import {
  computeMonth,
  computeMonths,
  type EngineActivity,
  type EngineAssignment,
  type EngineInput,
} from "../src/budget-engine";

const G = "g1";
const RENT = "rent";
const GRO = "gro";
const FUN = "fun";
const TARGET = "target";

const OCT = "2026-10-01";
const NOV = "2026-11-01";
const DEC = "2026-12-01";

function base(): EngineInput {
  return {
    groups: [{ id: G, name: "Bills", sortOrder: 0, hidden: false, collapsed: false }],
    categories: [RENT, GRO, FUN].map((id, i) => ({
      id,
      groupId: G,
      name: id,
      sortOrder: i,
      hidden: false,
    })),
    assignments: [],
    activity: [],
    notes: [],
  };
}
const tx = (
  date: string,
  amount: number,
  categoryId: string | null,
  o: Partial<EngineActivity> = {},
): EngineActivity => ({
  date,
  amount,
  categoryId,
  inflowToReadyToAssign: false,
  onBudget: true,
  accountType: "checking",
  ...o,
});
const inflow = (date: string, amount: number) =>
  tx(date, amount, null, { inflowToReadyToAssign: true });
const assign = (categoryId: string, month: string, assigned: number): EngineAssignment => ({
  categoryId,
  month,
  assigned,
});

function cat(input: EngineInput, month: string, id: string) {
  const d = computeMonth(input, month);
  const c = d.groups.flatMap((g) => g.categories).find((x) => x.id === id);
  if (!c) throw new Error("no category");
  return [c.assigned, c.activity, c.available] as const;
}
const grp = (input: EngineInput, month: string) => {
  const g = computeMonth(input, month).groups[0];
  return [g?.assigned, g?.activity, g?.available];
};

describe("worked example", () => {
  const input = base();
  it("step 3: October", () => {
    input.activity.push(inflow("2026-10-05", 500000));
    input.assignments.push(
      assign(RENT, OCT, 300000),
      assign(GRO, OCT, 150000),
      assign(FUN, OCT, 20000),
    );
    input.activity.push(tx("2026-10-10", -100000, GRO), tx("2026-10-12", -45000, FUN));
    expect(cat(input, OCT, RENT)).toEqual([300000, 0, 300000]);
    expect(cat(input, OCT, GRO)).toEqual([150000, -100000, 50000]);
    expect(cat(input, OCT, FUN)).toEqual([20000, -45000, -25000]);
    expect(grp(input, OCT)).toEqual([470000, -145000, 325000]);
    expect(computeMonth(input, OCT).ready_to_assign).toBe(30000);
  });
  it("step 4: November", () => {
    input.activity.push(inflow("2026-11-15", 1000000));
    input.assignments.push(
      assign(RENT, NOV, 450000),
      assign(GRO, NOV, 205000),
      assign(FUN, NOV, 0),
    );
    input.activity.push(tx("2026-11-20", -60000, GRO), tx("2026-11-21", -50000, FUN));
    expect(cat(input, NOV, RENT)).toEqual([450000, 0, 750000]);
    expect(cat(input, NOV, GRO)).toEqual([205000, -60000, 195000]);
    expect(cat(input, NOV, FUN)).toEqual([0, -50000, -50000]);
    expect(grp(input, NOV)).toEqual([655000, -110000, 895000]);
    const d = computeMonth(input, NOV);
    expect(d.groups[0]?.categories[0]?.carried).toBe(300000);
    expect(d.groups[0]?.categories[2]?.carried).toBe(0);
    expect(d.rta_breakdown.cash_overspending_previous).toBe(-25000);
    expect(d.ready_to_assign).toBe(350000);
  });
  it("step 5: cover October's overspending", () => {
    input.assignments.push(assign(GRO, OCT, -25000), assign(FUN, OCT, 25000));
    expect(cat(input, OCT, FUN)).toEqual([45000, -45000, 0]);
    expect(cat(input, OCT, GRO)).toEqual([125000, -100000, 25000]);
    expect(cat(input, NOV, GRO)[2]).toBe(170000);
    expect(grp(input, NOV)).toEqual([655000, -110000, 870000]);
    expect(computeMonth(input, NOV).ready_to_assign).toBe(375000);
  });
  it("step 6: December", () => {
    expect(cat(input, DEC, RENT)).toEqual([0, 0, 750000]);
    expect(cat(input, DEC, GRO)).toEqual([0, 0, 170000]);
    expect(cat(input, DEC, FUN)).toEqual([0, 0, 0]);
    input.assignments.push(assign(RENT, DEC, 100000));
    expect(cat(input, DEC, RENT)[2]).toBe(850000);
    const dec = computeMonth(input, DEC);
    expect(dec.rta_breakdown).toEqual({
      left_over_from_previous: 375000,
      inflows: 0,
      cash_overspending_previous: -50000,
      assigned_in_month: -100000,
      assigned_in_future: 0,
    });
    expect(dec.ready_to_assign).toBe(225000);
    const nov = computeMonth(input, NOV);
    expect(nov.rta_breakdown.assigned_in_future).toBe(-100000);
    expect(nov.ready_to_assign).toBe(275000);
  });
  it("step 7: Fun reassigned to another category", () => {
    const moved: EngineInput = {
      ...input,
      categories: [
        ...input.categories.filter((c) => c.id !== FUN),
        { id: TARGET, groupId: G, name: "t", sortOrder: 9, hidden: false },
      ],
      assignments: [
        ...input.assignments.filter((a) => a.categoryId !== FUN),
        assign(TARGET, OCT, 45000),
        assign(TARGET, NOV, 15000),
      ],
      activity: input.activity.map((a) =>
        a.categoryId === FUN ? { ...a, categoryId: TARGET } : a,
      ),
    };
    expect(cat(moved, OCT, TARGET)).toEqual([45000, -45000, 0]);
    expect(cat(moved, NOV, TARGET)).toEqual([15000, -50000, -35000]);
  });
});

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const MONTHS = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"];
function generated(seed: number): EngineInput {
  const r = rng(seed);
  const input = base();
  const money = () => Math.round((r() - 0.4) * 200) * 1000;
  for (const m of MONTHS.slice(0, 4)) {
    for (const c of [RENT, GRO, FUN]) {
      if (r() < 0.8) input.assignments.push(assign(c, m, money()));
      if (r() < 0.8) input.activity.push(tx(`${m.slice(0, 7)}-10`, -Math.abs(money()), c));
    }
    if (r() < 0.7) input.activity.push(inflow(`${m.slice(0, 7)}-03`, Math.abs(money()) * 3));
  }
  return input;
}

describe("properties", () => {
  const cases = Array.from({ length: 50 }, (_, i) => generated(i + 1));
  it("breakdown sums to Ready to Assign in every month", () => {
    for (const input of cases) {
      for (const m of MONTHS) {
        const d = computeMonth(input, m);
        const b = d.rta_breakdown;
        expect(
          b.left_over_from_previous +
            b.inflows +
            b.cash_overspending_previous +
            b.assigned_in_month +
            b.assigned_in_future,
        ).toBe(d.ready_to_assign);
      }
    }
  });
  it("positive Available carries, negative does not and is overspending next month", () => {
    for (const input of cases) {
      for (let i = 0; i < MONTHS.length - 1; i++) {
        const a = computeMonth(input, MONTHS[i] as string);
        const b = computeMonth(input, MONTHS[i + 1] as string);
        let neg = 0;
        a.groups[0]?.categories.forEach((c, j) => {
          const next = b.groups[0]?.categories[j];
          expect(next?.carried).toBe(Math.max(c.available, 0));
          neg += Math.min(c.available, 0);
        });
        expect(b.rta_breakdown.cash_overspending_previous).toBe(neg);
      }
    }
  });
  it("a move between categories leaves RTA unchanged; a move to RTA raises it by x", () => {
    for (const input of cases) {
      const month = MONTHS[2] as string;
      const x = 7000;
      const from =
        input.assignments.find((a) => a.categoryId === RENT && a.month === month)?.assigned ?? 0;
      const withMove = (toRta: boolean): EngineInput => ({
        ...input,
        assignments: [
          ...input.assignments,
          assign(RENT, month, -x),
          ...(toRta ? [] : [assign(GRO, month, x)]),
        ],
      });
      void from;
      for (const m of MONTHS.slice(0, 3)) {
        const before = computeMonth(input, m).ready_to_assign;
        expect(computeMonth(withMove(false), m).ready_to_assign).toBe(before);
        expect(computeMonth(withMove(true), m).ready_to_assign).toBe(before + x);
      }
    }
  });
  it("computeMonths agrees with computeMonth", () => {
    const input = cases[0] as EngineInput;
    const list = computeMonths(input, MONTHS[1] as string, MONTHS[5] as string);
    expect(list.map((s) => s.month)).toEqual(MONTHS.slice(1));
    for (const s of list)
      expect(s.ready_to_assign).toBe(computeMonth(input, s.month).ready_to_assign);
    expect(() => computeMonths(input, DEC, OCT)).toThrow(RangeError);
  });
});

describe("implicit rules", () => {
  it("tracking accounts change nothing", () => {
    const a = base();
    a.activity.push(inflow("2026-10-05", 10000), tx("2026-10-06", -5000, GRO));
    const b: EngineInput = {
      ...a,
      activity: [
        ...a.activity,
        tx("2026-10-07", -99000, GRO, { onBudget: false }),
        inflow("2026-10-08", 5000),
      ].map((t, i) => (i >= a.activity.length ? { ...t, onBudget: false } : t)),
    };
    for (const m of [OCT, NOV]) expect(computeMonth(b, m)).toEqual(computeMonth(a, m));
  });
  it("uncategorized outflow", () => {
    const input = base();
    input.activity.push(tx("2026-10-09", -10000, null));
    const oct = computeMonth(input, OCT);
    expect(oct.uncategorized).toEqual({ activity: -10000, available: -10000 });
    expect(oct.groups[0]?.available).toBe(0);
    const nov = computeMonth(input, NOV);
    expect(nov.rta_breakdown.cash_overspending_previous).toBe(-10000);
    expect(nov.uncategorized).toBeNull();
    expect(computeMonth(base(), OCT).uncategorized).toBeNull();
  });
  it("hidden category: out of subtotals, still lowers RTA", () => {
    const input = base();
    const hid = input.categories[0];
    if (hid) hid.hidden = true;
    input.assignments.push(assign(RENT, OCT, 5000));
    const d = computeMonth(input, OCT);
    expect(d.groups[0]?.assigned).toBe(0);
    expect(d.groups[0]?.categories[0]?.assigned).toBe(5000);
    expect(d.ready_to_assign).toBe(-5000);
  });
  it("unknown category counts as uncategorized; later inflow does not count", () => {
    const input = base();
    input.activity.push(tx("2026-10-09", -3000, "gone"), inflow("2026-11-02", 8000));
    expect(computeMonth(input, OCT).uncategorized?.activity).toBe(-3000);
    expect(computeMonth(input, OCT).ready_to_assign).toBe(0);
    expect(computeMonth(input, NOV).rta_breakdown.inflows).toBe(8000);
  });
});
