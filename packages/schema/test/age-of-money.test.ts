import { describe, expect, it } from "vitest";
import {
  type AgeRow,
  aomTopTick,
  computeAgeOfMoney,
  daysLabel,
  outflowAges,
  valueAt,
} from "../src/age-of-money";

const SET = new Set(["chk", "sav"]);
const row = (
  date: string,
  amount: number,
  account_id = "chk",
  transfer_account_id: string | null = null,
): AgeRow => ({
  date,
  amount,
  account_id,
  transfer_account_id,
});

const example = (): AgeRow[] => [
  row("2026-05-15", 500000, "sav"),
  row("2026-06-01", 2000000),
  row("2026-07-10", -120000),
  row("2026-07-15", 3000000),
  row("2026-07-22", -45000),
  row("2026-08-05", -80500),
  row("2026-08-15", 3000000),
  row("2026-08-20", -25000),
  row("2026-09-03", -60250),
  row("2026-09-12", -99990),
  row("2026-09-15", 3000000),
  row("2026-09-20", -15000),
  row("2026-10-01", -250000, "chk", "loan"),
  row("2026-10-07", -30000),
  row("2026-10-09", -150000),
  row("2026-10-15", 3000000),
  row("2026-10-25", -40000),
];

describe("Age of Money (ticket example)", () => {
  it("reproduces the eleven ages", () => {
    const ages = outflowAges(example(), SET, "2026-10-31").map(
      (a) => Math.round(a.age * 100) / 100,
    );
    expect(ages).toEqual([56, 68, 82, 97, 111, 120, 128, 125.69, 128, 130, 146]);
  });
  it("gives Oct 114", () => {
    expect(computeAgeOfMoney(example(), SET, "2026-10-31")).toEqual({
      current_days: 114,
      months: [{ month: "2026-10-01", days: 114 }],
    });
  });
  it("repeats the value in a month without an outflow", () => {
    expect(computeAgeOfMoney(example(), SET, "2026-11-15").months).toEqual([
      { month: "2026-10-01", days: 114 },
      { month: "2026-11-01", days: 114 },
    ]);
  });
  it("starts at the 10th outflow", () => {
    expect(computeAgeOfMoney(example(), SET, "2026-10-09")).toEqual({
      current_days: 105,
      months: [{ month: "2026-10-01", days: 105 }],
    });
    expect(computeAgeOfMoney(example(), SET, "2026-10-08")).toEqual({
      current_days: null,
      months: [],
    });
  });
  it("ignores a transfer between two cash accounts", () => {
    const rows = [
      ...example(),
      row("2026-10-02", -300000, "chk", "sav"),
      row("2026-10-02", 300000, "sav", "chk"),
    ];
    expect(outflowAges(rows, SET, "2026-10-31")).toHaveLength(11);
    expect(computeAgeOfMoney(rows, SET, "2026-10-31").current_days).toBe(114);
  });
  it("ignores rows after today and other accounts", () => {
    const rows = [...example(), row("2026-11-20", -1000), row("2026-10-20", -20000, "card")];
    expect(computeAgeOfMoney(rows, SET, "2026-10-31").current_days).toBe(114);
  });
});

describe("Age of Money (other cases)", () => {
  it("has no value below 10 outflows", () => {
    const rows = [
      row("2026-01-01", 100000),
      ...Array.from({ length: 9 }, (_, i) => row(`2026-01-0${i + 2}`, -1000)),
    ];
    expect(computeAgeOfMoney(rows, SET, "2026-01-31")).toEqual({ current_days: null, months: [] });
    expect(valueAt(outflowAges(rows, SET, "2026-01-31"), "2026-01-31")).toBeNull();
  });
  it("counts a parent once, weighted over its whole amount", () => {
    const rows = [
      row("2026-01-01", 1000000),
      ...Array.from({ length: 9 }, (_, i) => row(`2026-01-0${i + 2}`, -1000)),
      row("2026-01-20", -100000),
    ];
    const ages = outflowAges(rows, SET, "2026-01-31");
    expect(ages).toHaveLength(10);
    expect(ages[9]?.age).toBe(19);
  });
  it("gives age 0 to money that is not covered", () => {
    const rows = [
      row("2026-01-01", 10000),
      ...Array.from({ length: 10 }, (_, i) =>
        row(`2026-01-${String(i + 2).padStart(2, "0")}`, -2000),
      ),
    ];
    const ages = outflowAges(rows, SET, "2026-01-31").map((a) => a.age);
    expect(ages).toEqual([1, 2, 3, 4, 5, 0, 0, 0, 0, 0]);
    expect(computeAgeOfMoney(rows, SET, "2026-01-31").current_days).toBe(2);
    expect(
      outflowAges([row("2026-01-01", 10000), row("2026-01-11", -15000)], SET, "2026-01-31")[0]?.age,
    ).toBeCloseTo(6.67, 2);
  });
  it("lets an inflow pay the same day's outflow", () => {
    const rows = [
      row("2026-01-01", 100000),
      row("2026-01-05", -100000),
      row("2026-01-10", -50000),
      row("2026-01-10", 50000),
      row("2026-01-12", -10000),
    ];
    expect(outflowAges(rows, SET, "2026-01-31").map((a) => a.age)).toEqual([4, 0, 0]);
  });
  it("repeats the value over months with no outflow", () => {
    const rows = [
      row("2026-01-01", 1000000),
      ...Array.from({ length: 10 }, (_, i) =>
        row(`2026-01-${String(i + 2).padStart(2, "0")}`, -1000),
      ),
    ];
    const months = computeAgeOfMoney(rows, SET, "2026-03-15").months;
    expect(months.map((m) => m.month)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(new Set(months.map((m) => m.days)).size).toBe(1);
  });
  it("rounds half up", () => {
    const ages = Array.from({ length: 10 }, (_, i) => ({
      date: "2026-01-01",
      age: i === 0 ? 5 : 0,
    }));
    expect(valueAt(ages, "2026-01-01")).toBe(1);
  });
});

describe("chart helpers", () => {
  it("aomTopTick", () => {
    expect([141, 122, 114, 100, 7, 0].map(aomTopTick)).toEqual([160, 140, 120, 100, 7, 10]);
  });
  it("daysLabel", () => {
    expect([1, 0, 122].map(daysLabel)).toEqual(["1 day", "0 days", "122 days"]);
  });
});
