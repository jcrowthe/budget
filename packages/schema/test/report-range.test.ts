import { describe, expect, it } from "vitest";
import {
  addMonthsTo,
  canShift,
  clampSpan,
  monthCount,
  monthLabel,
  monthOfDate,
  monthsIn,
  planFirstMonth,
  presetSpan,
  rangeLabel,
  resolveRange,
  shiftSpan,
  shortMonthLabel,
} from "../src/report-range";

// Today is 2026-11-15 throughout.
const cur = monthOfDate("2026-11-15");
const facts = (first: string) => ({ first_month: first, current_month: cur });
const JUN = facts("2026-06-01");
const span = (s: string, e: string) => ({ start_month: s, end_month: e });

describe("presets (unclamped)", () => {
  it.each([
    ["this_month", "2026-11-01", "2026-11-01"],
    ["last_3_months", "2026-09-01", "2026-11-01"],
    ["last_6_months", "2026-06-01", "2026-11-01"],
    ["last_12_months", "2025-12-01", "2026-11-01"],
    ["year_to_date", "2026-01-01", "2026-11-01"],
    ["last_year", "2025-01-01", "2025-12-01"],
    ["all_dates", "2026-06-01", "2026-11-01"],
  ] as const)("%s", (p, s, e) => {
    expect(presetSpan(p, JUN)).toEqual(span(s, e));
  });
});

describe("clamping", () => {
  it("first month Jun 2026", () => {
    for (const p of ["last_12_months", "year_to_date", "all_dates"] as const) {
      expect(resolveRange(p, null, JUN)).toEqual(span("2026-06-01", "2026-11-01"));
    }
    expect(resolveRange("last_year", null, JUN)).toEqual(span("2026-06-01", "2026-06-01"));
  });
  it("first month May 2026", () => {
    const f = facts("2026-05-01");
    expect(resolveRange("all_dates", null, f)).toEqual(span("2026-05-01", "2026-11-01"));
    expect(resolveRange("last_year", null, f)).toEqual(span("2026-05-01", "2026-05-01"));
    expect(resolveRange("last_3_months", null, f)).toEqual(span("2026-09-01", "2026-11-01"));
  });
  it("custom clamps, null months mean all dates, after today gives the current month", () => {
    expect(resolveRange("custom", span("2026-01-01", "2027-03-01"), JUN)).toEqual(
      span("2026-06-01", "2026-11-01"),
    );
    expect(resolveRange("custom", { start_month: null, end_month: null }, JUN)).toEqual(
      span("2026-06-01", "2026-11-01"),
    );
    expect(clampSpan(span("2027-01-01", "2027-02-01"), JUN)).toEqual(span(cur, cur));
  });
  it("planFirstMonth", () => {
    expect(planFirstMonth(null, cur)).toBe(cur);
    expect(planFirstMonth("2027-02-01", cur)).toBe(cur);
    expect(planFirstMonth("2026-05-01", cur)).toBe("2026-05-01");
  });
});

describe("arrows", () => {
  it("Jun–Nov: both disabled", () => {
    const r = span("2026-06-01", "2026-11-01");
    expect(canShift(r, -1, JUN)).toBe(false);
    expect(canShift(r, 1, JUN)).toBe(false);
  });
  it("Sep–Nov: back on, forward off", () => {
    const r = span("2026-09-01", "2026-11-01");
    expect(canShift(r, -1, JUN)).toBe(true);
    expect(canShift(r, 1, JUN)).toBe(false);
  });
  it("Sep–Oct: back on (gives Jul–Aug), forward off", () => {
    const r = span("2026-09-01", "2026-10-01");
    expect(canShift(r, -1, JUN)).toBe(true);
    expect(canShift(r, 1, JUN)).toBe(false);
    expect(shiftSpan(r, -1)).toEqual(span("2026-07-01", "2026-08-01"));
  });
  it("Jul–Aug: back off, forward on", () => {
    const r = span("2026-07-01", "2026-08-01");
    expect(canShift(r, -1, JUN)).toBe(false);
    expect(canShift(r, 1, JUN)).toBe(true);
  });
  it("Nov: back gives Oct, forward off", () => {
    const r = span(cur, cur);
    expect(canShift(r, -1, JUN)).toBe(true);
    expect(shiftSpan(r, -1)).toEqual(span("2026-10-01", "2026-10-01"));
    expect(canShift(r, 1, JUN)).toBe(false);
  });
  it("year boundaries", () => {
    expect(shiftSpan(span("2026-01-01", "2026-01-01"), -1)).toEqual(
      span("2025-12-01", "2025-12-01"),
    );
    expect(addMonthsTo("2025-12-01", 1)).toBe("2026-01-01");
  });
});

describe("helpers and labels", () => {
  it("counts and lists months", () => {
    expect(monthCount(span("2026-09-01", "2026-11-01"))).toBe(3);
    expect(monthsIn(span("2025-11-01", "2026-02-01"))).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });
  it("labels use an en dash", () => {
    expect(monthLabel("2026-11-01")).toBe("Nov 2026");
    expect(shortMonthLabel("2026-11-01")).toBe("11/26");
    expect(rangeLabel(span(cur, cur))).toBe("Nov 2026");
    expect(rangeLabel(span("2026-06-01", cur))).toBe("Jun 2026 – Nov 2026");
  });
});
