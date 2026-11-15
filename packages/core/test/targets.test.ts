import { describe, expect, it } from "vitest";
import { computeMonth, type EngineInput } from "../src/budget-engine";
import {
  ceilCent,
  computeTargetMonth,
  countWeekdays,
  type TargetDefinition,
  targetPeriod,
} from "../src/targets";

const NOV = "2026-11-01";
const DEC = "2026-12-01";
const JAN = "2027-01-01";
const TODAY = "2026-11-15";

const def = (o: Partial<TargetDefinition>): TargetDefinition => ({
  cadence: "monthly",
  behavior: "set_aside",
  amount: 100000,
  day_of_week: null,
  day_of_month: null,
  due_date: null,
  due_month: null,
  repeat: null,
  created_on: "2026-11-15",
  ...o,
});

function run(
  d: TargetDefinition,
  month: string,
  o: { L?: number; A?: number; X?: number; history?: Record<string, number> } = {},
) {
  const L = o.L ?? 0;
  const A = o.A ?? 0;
  const X = o.X ?? 0;
  const history = o.history ?? {};
  return computeTargetMonth(d, {
    month,
    today: TODAY,
    leftover: L,
    assigned: A,
    activity: X,
    available: L + A + X,
    assignedIn: (m) => history[m] ?? 0,
  });
}
const t = (d: TargetDefinition, month: string, o?: Parameters<typeof run>[2]) => {
  const r = run(d, month, o);
  if (!r) throw new Error("no target");
  return r;
};
const pick = (r: ReturnType<typeof t>) => ({
  needed: r.needed_this_month,
  funded: r.funded,
  toGo: r.to_go_this_month,
  over: r.overfunded,
  pct: r.percent,
  status: r.status,
});

describe("rounding and helpers", () => {
  it("ceilCent rounds up to the cent", () => {
    expect(ceilCent(620000, 6)).toBe(103340);
    expect(ceilCent(516660, 5)).toBe(103340);
    expect(ceilCent(516660, 4)).toBe(129170);
    expect(ceilCent(600000, 6)).toBe(100000);
    expect(ceilCent(0, 3)).toBe(0);
    expect(ceilCent(-5, 3)).toBe(0);
  });
  it("counts weekdays", () => {
    expect(countWeekdays(NOV, 6)).toBe(4);
    expect(countWeekdays(NOV, 6, "2026-11-15")).toBe(2);
    expect(countWeekdays(DEC, 6)).toBe(4);
    expect(countWeekdays(JAN, 6)).toBe(5);
  });
});

describe("example 1: monthly set aside", () => {
  const d = def({});
  it("November", () => {
    expect(pick(t(d, NOV, { A: 40000 }))).toMatchObject({
      needed: 100000,
      toGo: 60000,
      pct: 40,
      status: "underfunded",
    });
    expect(t(d, NOV, { A: 100000 }).status).toBe("funded");
    expect(pick(t(d, NOV, { A: 150000 }))).toMatchObject({ status: "funded", over: 50000 });
    const spent = t(d, NOV, { A: 100000, X: -30000 });
    expect(spent.status).toBe("funded");
  });
  it("December ignores the leftover", () => {
    expect(pick(t(d, DEC, { L: 70000 }))).toMatchObject({ needed: 100000, toGo: 100000 });
    expect(t(d, DEC, { L: 70000, A: 30000 }).to_go_this_month).toBe(70000);
  });
  it("example 2: funded is assigned only", () => {
    const r = t(d, NOV, { L: 50000, A: 50000 });
    expect(r.funded).toBe(50000);
    expect(r.to_go_this_month).toBe(50000);
    expect(r.status).toBe("underfunded");
  });
  it("a due day already passed gives no overdue state", () => {
    const r = t(def({ day_of_month: 10 }), NOV, { A: 0 });
    expect(r.status).toBe("underfunded");
    expect(r.period_due_date).toBe("2026-11-10");
  });
  it("last day when no due day", () => {
    expect(t(d, "2027-02-01").period_due_date).toBe("2027-02-28");
  });
});

describe("example 3: monthly refill", () => {
  const d = def({ behavior: "refill" });
  it("current month counts the leftover", () => {
    const a = t(d, NOV, { L: 50000, A: 50000 });
    expect([a.funded, a.to_go_this_month, a.status]).toEqual([100000, 0, "funded"]);
    const b = t(d, NOV, { L: 50000, A: 100000 });
    expect([b.funded, b.overfunded]).toEqual([150000, 50000]);
  });
  it("future months count only assigned (copied from the source)", () => {
    const a = t(d, DEC, { L: 70000 });
    expect([a.needed_this_month, a.funded, a.to_go_this_month]).toEqual([100000, 0, 100000]);
    const b = t(d, DEC, { L: 70000, A: 30000 });
    expect([b.funded, b.to_go_this_month]).toEqual([30000, 70000]);
    expect(t(d, JAN, { L: 100000 }).to_go_this_month).toBe(100000);
  });
});

describe("example 4: weekly", () => {
  const d = def({ cadence: "weekly", amount: 25000, day_of_week: 6 });
  it("excuses dates before creation in the creation month", () => {
    const r = t(d, NOV);
    expect([r.needed_this_month, r.amount_this_month]).toEqual([50000, 100000]);
    const m = t(d, NOV, { A: 50000 });
    expect([m.to_go_this_month, m.status]).toEqual([0, "funded"]);
  });
  it("later months count every date", () => {
    expect(t(d, DEC).needed_this_month).toBe(100000);
    expect(t(d, JAN).needed_this_month).toBe(125000);
  });
  it("weekly $10 adds 40 to Cost to Be Me in November", () => {
    expect(
      t(def({ cadence: "weekly", amount: 10000, day_of_week: 6 }), NOV).amount_this_month,
    ).toBe(40000);
  });
  it("a target created on the last Sunday needs nothing", () => {
    const late = def({
      cadence: "weekly",
      amount: 25000,
      day_of_week: 6,
      created_on: "2026-11-29",
    });
    const r = t(late, NOV);
    expect([r.needed_this_month, r.status, r.amount_this_month]).toEqual([0, "funded", 100000]);
  });
});

describe("example 5: yearly", () => {
  const d = def({ cadence: "yearly", amount: 1200000, due_date: "2027-10-31" });
  it("spreads over the months remaining", () => {
    const nov = t(d, NOV);
    expect(nov.needed_this_month).toBe(100000);
    const done = t(d, NOV, { A: 100000 });
    expect([done.percent, done.status]).toEqual([8, "on_track"]);
    expect(t(d, DEC, { history: { [NOV]: 100000 } }).needed_this_month).toBe(100000);
    expect(t(d, JAN, { history: { [NOV]: 100000 } }).needed_this_month).toBe(110000);
    expect(t(d, JAN).needed_this_month).toBe(120000);
  });
  it("starts a new period each year", () => {
    const p = targetPeriod(d, "2027-11-01");
    expect(p).toMatchObject({ dueDate: "2028-10-31", monthsRemaining: 12 });
  });
});

describe("example 6: custom balance by a month", () => {
  const d = def({
    cadence: "custom",
    behavior: "balance",
    amount: 600000,
    due_month: "2027-04-01",
  });
  it("November", () => {
    expect(t(d, NOV).needed_this_month).toBe(100000);
    const a = t(d, NOV, { A: 150000, X: -20000 });
    expect([a.funded, a.needed_this_month, a.overfunded, a.percent]).toEqual([
      130000, 103340, 46660, 21,
    ]);
    expect(t(d, NOV, { A: 100000, X: -20000 }).to_go_this_month).toBe(3340);
    expect(t(d, NOV, { A: 103330, X: -20000 }).to_go_this_month).toBe(10);
    expect(t(d, NOV, { A: 103340, X: -20000 }).status).toBe("on_track");
  });
  it("December and January count the leftover", () => {
    expect(t(d, DEC, { L: 83340 }).needed_this_month).toBe(103340);
    expect(t(d, JAN, { L: 83340 }).needed_this_month).toBe(129170);
    expect(t(d, JAN).needed_this_month).toBe(150000);
  });
});

describe("example 7: custom set aside", () => {
  it("by a date, and repeating", () => {
    expect(
      t(def({ cadence: "custom", amount: 300000, due_date: "2027-01-31" }), NOV).needed_this_month,
    ).toBe(100000);
    const rep = def({
      cadence: "custom",
      amount: 90000,
      due_date: "2027-01-15",
      repeat: { every: 3, unit: "month" },
    });
    expect(t(rep, NOV).needed_this_month).toBe(30000);
  });
  it("periods", () => {
    const rep = def({
      cadence: "custom",
      amount: 90000,
      due_date: "2027-01-15",
      repeat: { every: 3, unit: "month" },
    });
    expect(targetPeriod(rep, "2027-02-01")).toEqual({
      dueDate: "2027-04-15",
      dueMonth: "2027-04-01",
      startMonth: "2027-02-01",
      monthsRemaining: 3,
    });
    expect(targetPeriod({ ...rep, repeat: null }, "2027-02-01")).toBe("complete");
  });
});

describe("example 8: custom fill up", () => {
  const d = def({ cadence: "custom", behavior: "fill_up", amount: 80000, due_date: "2026-12-31" });
  it("walks to complete", () => {
    expect(t(d, NOV).needed_this_month).toBe(40000);
    const a = t(d, NOV, { A: 50000 });
    expect([a.status, a.percent]).toEqual(["on_track", 62]);
    const dec = t(d, DEC, { L: 50000 });
    expect([dec.to_go_this_month, dec.due_this_month]).toEqual([30000, true]);
    expect(t(d, DEC, { L: 50000, A: 30000 }).status).toBe("funded");
    const jan = t(d, JAN, { L: 80000 });
    expect([jan.status, jan.needed_this_month, jan.due_this_month]).toEqual(["complete", 0, false]);
  });
  it("counts the leftover in every month", () => {
    expect(t(d, NOV, { L: 50000 }).needed_this_month).toBe(15000);
  });
});

describe("example 9: balance with no date", () => {
  const d = def({ cadence: "custom", behavior: "balance", amount: 60000 });
  it("needs nothing and is never underfunded", () => {
    const r = t(d, NOV);
    expect([r.needed_this_month, r.status, r.overall_to_go]).toEqual([0, "eventually", 60000]);
    for (const L of [-5000, 0, 30000, 70000])
      for (const A of [0, 10000, 90000])
        for (const X of [0, -20000]) {
          const x = t(d, DEC, { L, A, X });
          expect(["eventually", "funded"]).toContain(x.status);
          expect(x.needed_this_month).toBe(0);
        }
  });
});

describe("leftover rules and before creation", () => {
  it("set aside ignores the leftover in the current and a future month", () => {
    const d = def({});
    expect(t(d, NOV, { L: 50000 }).to_go_this_month).toBe(100000);
    expect(t(d, DEC, { L: 50000 }).to_go_this_month).toBe(100000);
  });
  it("refill needs 50000 now and 100000 in December", () => {
    const d = def({ behavior: "refill" });
    expect(t(d, NOV, { L: 50000 }).to_go_this_month).toBe(50000);
    expect(t(d, DEC, { L: 50000 }).to_go_this_month).toBe(100000);
  });
  it("balance by a month counts the leftover in a future month", () => {
    const d = def({
      cadence: "custom",
      behavior: "balance",
      amount: 600000,
      due_month: "2027-04-01",
    });
    expect(t(d, DEC, { L: 50000 }).needed_this_month).toBe(110000);
  });
  it("no target before the month it was created", () => {
    expect(run(def({}), "2026-10-01")).toBeNull();
  });
});

describe("engine wiring", () => {
  const input: EngineInput = {
    groups: [{ id: "g", name: "G", sortOrder: 0, hidden: false, collapsed: false }],
    categories: [
      { id: "c1", groupId: "g", name: "Rent", sortOrder: 0, hidden: false },
      { id: "c2", groupId: "g", name: "Other", sortOrder: 1, hidden: false },
    ],
    assignments: [
      { categoryId: "c1", month: NOV, assigned: 100000 },
      { categoryId: "c1", month: DEC, assigned: 30000 },
    ],
    activity: [
      {
        date: "2026-11-10",
        amount: -30000,
        categoryId: "c1",
        inflowToReadyToAssign: false,
        onBudget: true,
        accountType: "cash",
      },
    ],
    notes: [],
    targets: [{ categoryId: "c1", ...def({}) }],
    today: TODAY,
  };
  it("returns the target per category", () => {
    const d = computeMonth(input, DEC);
    const [c1, c2] = d.groups[0]?.categories ?? [];
    expect(c1?.target?.to_go_this_month).toBe(70000);
    expect(c2?.target).toBeNull();
  });
  it("needs today", () => {
    expect(() => computeMonth({ ...input, today: undefined }, DEC)).toThrow(RangeError);
  });
});
