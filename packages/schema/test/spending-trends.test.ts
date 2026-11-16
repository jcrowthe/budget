import { describe, expect, it } from "vitest";
import type { SpendingRow } from "../src/spending-breakdown";
import { comparedPct, computeTrends, tenthsHalfUp } from "../src/spending-trends";

let n = 0;
interface Cat {
  id: string;
  name: string;
  order: number;
  group?: { id: string; name: string; order: number };
  hidden?: boolean;
}
const D8 = { id: "g1", name: "D8 Group", order: 1 };
const FOOD: Cat = { id: "c-food", name: "D8 Food", order: 1 };
const FUN: Cat = { id: "c-fun", name: "D8 Fun", order: 2 };
const UTIL: Cat = { id: "c-util", name: "D8 Utilities", order: 3 };
const LOAN: Cat = { id: "c-loan", name: "D8 Loan Pmt", order: 4 };
const HIDDEN: Cat = { id: "c-hid", name: "D8 Hidden", order: 5, hidden: true };

function row(date: string, cat: Cat | null, amount: number): SpendingRow {
  n += 1;
  const id = `t${String(n).padStart(3, "0")}`;
  const g = cat ? (cat.group ?? D8) : null;
  return {
    id,
    transaction_id: id,
    subtransaction_id: null,
    account_id: "a-check",
    account_name: "D8 Checking",
    date,
    created_at: `2026-11-01T00:00:${String(n).padStart(2, "0")}Z`,
    split_index: null,
    amount,
    payee_name: null,
    memo: null,
    cleared: "uncleared",
    category_id: cat?.id ?? null,
    category_name: cat?.name ?? null,
    category_hidden: cat?.hidden ?? false,
    category_order: cat?.order ?? 0,
    group_id: g?.id ?? null,
    group_name: g?.name ?? null,
    group_hidden: false,
    group_order: g?.order ?? 0,
  };
}

const EXAMPLE: SpendingRow[] = [
  row("2026-07-10", FOOD, -120000),
  row("2026-07-22", FUN, -45000),
  row("2026-08-05", FOOD, -80500),
  row("2026-08-20", FUN, -25000),
  row("2026-09-03", UTIL, -60250),
  row("2026-09-12", FOOD, -99990),
  row("2026-09-20", null, -15000),
  row("2026-10-01", LOAN, -250000),
  row("2026-10-07", FUN, -30000),
  row("2026-10-09", FOOD, -150000),
  row("2026-10-21", FOOD, 20000),
  row("2026-10-25", HIDDEN, -40000),
  row("2026-11-03", FOOD, -55000),
];
const span = (a: string, b: string) => ({ start_month: `${a}-01`, end_month: `${b}-01` });
const cmp = (d: ReturnType<typeof computeTrends>) =>
  d.months.map((m) => [m.month.slice(5, 7), m.compared_to_average, m.compared_pct]);

describe("rounding helpers", () => {
  it("rounds to one decimal, half up", () => {
    expect(tenthsHalfUp(130000, 450000)).toBe(28.9);
    expect(tenthsHalfUp(1, 8)).toBe(12.5);
    expect(tenthsHalfUp(1, 3000)).toBe(0);
    expect(tenthsHalfUp(1, 2000)).toBe(0.1);
  });
  it("is 0 when the average is 0", () => {
    expect(comparedPct(5000, 0)).toBe(0);
    expect(comparedPct(-5000, 20000)).toBe(25);
  });
});

describe("computeTrends: the ticket's example", () => {
  it("May–Nov: totals, average and every comparison", () => {
    const d = computeTrends({ rows: EXAMPLE, span: span("2026-05", "2026-11"), group: null });
    expect(d.months.map((m) => m.total)).toEqual([0, 0, 165000, 105500, 175240, 450000, 55000]);
    expect(d.total).toBe(950740);
    expect(d.average_monthly).toBe(135820);
    expect(cmp(d)).toEqual([
      ["05", -135820, 100],
      ["06", -135820, 100],
      ["07", 29180, 21.5],
      ["08", -30320, 22.3],
      ["09", 39420, 29],
      ["10", 314180, 231.3],
      ["11", -80820, 59.5],
    ]);
  });

  it("Sep–Nov", () => {
    const d = computeTrends({ rows: EXAMPLE, span: span("2026-09", "2026-11"), group: null });
    expect(d.total).toBe(680240);
    expect(d.average_monthly).toBe(226750);
    expect(cmp(d)).toEqual([
      ["09", -51510, 22.7],
      ["10", 223250, 98.5],
      ["11", -171750, 75.7],
    ]);
  });

  it("This month only: average equals total, comparison is zero", () => {
    const d = computeTrends({ rows: EXAMPLE, span: span("2026-11", "2026-11"), group: null });
    expect(d.total).toBe(55000);
    expect(d.average_monthly).toBe(55000);
    expect(cmp(d)).toEqual([["11", 0, 0]]);
  });

  it("Oct is one group segment at 100%, and Sep splits Uncategorized out", () => {
    const d = computeTrends({ rows: EXAMPLE, span: span("2026-05", "2026-11"), group: null });
    expect(d.months[5]?.series).toEqual([
      { id: "g1", name: "D8 Group", amount: 450000, share_pct: 100 },
    ]);
    expect(d.months[4]?.series).toEqual([
      { id: "g1", name: "D8 Group", amount: 160240, share_pct: 91.4 },
      { id: "uncategorized", name: "Uncategorized Transactions", amount: 15000, share_pct: 8.6 },
    ]);
  });

  it("drilled into D8 Group, May–Nov", () => {
    const d = computeTrends({
      rows: EXAMPLE,
      span: span("2026-05", "2026-11"),
      group: { id: "g1", name: "D8 Group" },
    });
    expect(d.total).toBe(935740);
    expect(d.average_monthly).toBe(133680);
    expect(d.series.map((s) => [s.name, s.total])).toEqual([
      ["D8 Food", 485490],
      ["D8 Loan Pmt", 250000],
      ["D8 Fun", 100000],
      ["D8 Utilities", 60250],
      ["D8 Hidden", 40000],
    ]);
    // Series keep the rank order (range total, then plan order) inside each month.
    expect(d.months[5]?.series.map((s) => [s.name, s.amount, s.share_pct])).toEqual([
      ["D8 Food", 130000, 28.9],
      ["D8 Loan Pmt", 250000, 55.6],
      ["D8 Fun", 30000, 6.7],
      ["D8 Hidden", 40000, 8.9],
    ]);
  });

  it("an empty span has every month and zero figures", () => {
    const d = computeTrends({ rows: [], span: span("2026-09", "2026-11"), group: null });
    expect(d.months).toHaveLength(3);
    expect(d.total).toBe(0);
    expect(d.average_monthly).toBe(0);
    expect(d.series).toEqual([]);
    expect(d.months.every((m) => m.compared_pct === 0 && m.series.length === 0)).toBe(true);
  });
});

describe("computeTrends: a net inflow and a split", () => {
  const T1 = { id: "gt1", name: "T Needs", order: 1 };
  const T2 = { id: "gt2", name: "T Wants", order: 2 };
  const rows = [
    row("2026-11-04", { id: "c-tf", name: "T Food", order: 1, group: T1 }, -60000),
    row("2026-11-04", { id: "c-tu", name: "T Fun", order: 1, group: T2 }, -40000),
    row("2026-11-06", null, 50000),
  ];
  it("keeps the net inflow below zero, with no share, and lowers the total", () => {
    const d = computeTrends({ rows, span: span("2026-11", "2026-11"), group: null });
    expect(d.months[0]?.series).toEqual([
      { id: "gt1", name: "T Needs", amount: 60000, share_pct: 60 },
      { id: "gt2", name: "T Wants", amount: 40000, share_pct: 40 },
      { id: "uncategorized", name: "Uncategorized Transactions", amount: -50000, share_pct: null },
    ]);
    expect(d.months[0]?.total).toBe(50000);
    expect(d.total).toBe(50000);
    expect(d.average_monthly).toBe(50000);
  });
});
