import { describe, expect, it } from "vitest";
import {
  computeNetWorth,
  csvAmount,
  type MonthlySum,
  netWorthCsv,
  percentChange,
} from "../src/net-worth";

const accounts = [
  { id: "chk", name: "D8 Checking" },
  { id: "sav", name: "D8 Savings" },
  { id: "house", name: "D8 House" },
  { id: "loan", name: "D8 Car Loan" },
];
// Monthly sums in milliunits (EXF-551 example data).
const s = (account_id: string, month: string, amount: number): MonthlySum => ({
  account_id,
  month,
  amount,
});
const SUMS: MonthlySum[] = [
  s("sav", "2026-05-01", 500000),
  s("sav", "2026-09-01", 200000),
  s("chk", "2026-06-01", 2000000),
  s("chk", "2026-07-01", 3000000 - 120000 - 45000),
  s("chk", "2026-08-01", 3000000 - 80500 - 25000),
  s("chk", "2026-09-01", -200000 - 60250 - 99990 + 3000000 - 15000),
  s("chk", "2026-10-01", -250000 - 30000 - 150000 + 3000000 + 20000 - 40000),
  s("chk", "2026-11-01", -55000),
  s("house", "2026-06-01", 10000000),
  s("house", "2026-10-01", 500000),
  s("loan", "2026-06-01", -5000000),
  s("loan", "2026-10-01", 250000),
];
const base = { accounts, sums: SUMS, first_month: "2026-05-01" };
const all = (extra: Partial<Parameters<typeof computeNetWorth>[0]> = {}) =>
  computeNetWorth({ ...base, start_month: "2026-05-01", end_month: "2026-11-01", ...extra });

describe("net worth", () => {
  const r = all();
  it("end-of-month net worth May to Nov", () => {
    expect(r.months.map((m) => m.net_worth)).toEqual([
      500000, 7500000, 10335000, 13229500, 16054260, 19354260, 19299260,
    ]);
    expect(r.has_data).toBe(true);
  });
  it("header values are the last month's", () => {
    expect(r.assets).toBe(24049260);
    expect(r.debts).toBe(-4750000);
    expect(r.net_worth).toBe(19299260);
    expect(r.change).toBe(18799260);
    expect(r.change_pct).toBe(3759.9);
  });
  it("monthly change and percent", () => {
    expect(r.months.map((m) => [m.change, m.change_pct])).toEqual([
      [0, 0],
      [7000000, 1400],
      [2835000, 37.8],
      [2894500, 28],
      [2824760, 21.4],
      [3300000, 20.6],
      [-55000, -0.3],
    ]);
  });
  it("range changes", () => {
    const sepNov = all({ start_month: "2026-09-01" });
    expect([sepNov.change, sepNov.change_pct]).toEqual([3245000, 20.2]);
    const julSep = all({ start_month: "2026-07-01", end_month: "2026-09-01" });
    expect(julSep.net_worth).toBe(16054260);
    expect(julSep.assets).toBe(21054260);
    expect(julSep.debts).toBe(-5000000);
    expect([julSep.change, julSep.change_pct]).toEqual([5719260, 55.3]);
    // The first row uses the month before the range.
    expect([julSep.months[0]?.change, julSep.months[0]?.change_pct]).toEqual([2835000, 37.8]);
  });
  it("splits by the sign of each balance", () => {
    const x = all({ sums: [...SUMS, s("sav", "2026-11-01", -1000000)] });
    expect(x.assets).toBe(23349260);
    expect(x.debts).toBe(-5050000);
  });
  it("excluded accounts leave every figure", () => {
    const x = all({ accounts: accounts.slice(0, 2) });
    expect(x.net_worth).toBe(13549260);
    expect(x.debts).toBe(0);
    expect(Object.is(x.debts, -0)).toBe(false);
    expect(x.months[1]?.net_worth).toBe(2500000);
  });
  it("one-month range, and no data", () => {
    const one = all({ start_month: "2026-11-01" });
    expect([one.change, one.change_pct, one.months.length]).toEqual([0, 0, 1]);
    const none = computeNetWorth({
      accounts: [],
      sums: [],
      first_month: "2026-11-01",
      start_month: "2026-11-01",
      end_month: "2026-11-01",
    });
    expect([none.has_data, none.net_worth, none.change, none.change_pct]).toEqual([false, 0, 0, 0]);
  });
  it("percentChange", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(-55000, 19354260)).toBe(-0.3);
    expect(percentChange(1, -4)).toBe(25);
  });
});

describe("csv", () => {
  it("amounts", () => {
    expect(csvAmount(12849260)).toBe("12849.26");
    expect(csvAmount(-5000000)).toBe("-5000.00");
    expect(csvAmount(5)).toBe("0.01");
    expect(csvAmount(-5)).toBe("-0.01");
    expect(csvAmount(4)).toBe("0.00");
    expect(csvAmount(-4)).toBe("0.00");
  });
  it("matches the ticket's file", () => {
    expect(netWorthCsv(all())).toBe(
      [
        '"Account","May 2026","Jun 2026","Jul 2026","Aug 2026","Sep 2026","Oct 2026","Nov 2026"',
        '"D8 Checking",0.00,2000.00,4835.00,7729.50,10354.26,12904.26,12849.26',
        '"D8 Savings",500.00,500.00,500.00,500.00,700.00,700.00,700.00',
        '"D8 House",0.00,10000.00,10000.00,10000.00,10000.00,10500.00,10500.00',
        '"D8 Car Loan",0.00,-5000.00,-5000.00,-5000.00,-5000.00,-4750.00,-4750.00',
        '"Net Worth",500.00,7500.00,10335.00,13229.50,16054.26,19354.26,19299.26',
      ].join("\n"),
    );
  });
  it("doubles quotes in names", () => {
    const x = computeNetWorth({
      accounts: [{ id: "a", name: 'My "main"' }],
      sums: [s("a", "2026-11-01", 1000)],
      first_month: "2026-11-01",
      start_month: "2026-11-01",
      end_month: "2026-11-01",
    });
    expect(netWorthCsv(x)).toBe('"Account","Nov 2026"\n"My ""main""",1.00\n"Net Worth",1.00');
  });
});
