import { describe, expect, it } from "vitest";
import {
  addMonths,
  effectiveRange,
  presetRange,
  registerVisible,
  yearOptions,
} from "../src/register-view";
import { mergeViewSettings, VIEW_DEFAULTS } from "../src/view-settings";

const TODAY = "2026-11-17";
const FIRST = "2026-11-01";

describe("presetRange", () => {
  it("gives the source's months on 2026-11-17", () => {
    expect(presetRange("this_month", TODAY, FIRST)).toEqual({
      from: "2026-11-01",
      to: "2026-11-01",
    });
    expect(presetRange("last_month", TODAY, FIRST)).toEqual({
      from: "2026-10-01",
      to: "2026-10-01",
    });
    expect(presetRange("latest_3_months", TODAY, FIRST)).toEqual({
      from: "2026-09-01",
      to: "2026-11-01",
    });
    expect(presetRange("this_year", TODAY, FIRST)).toEqual({
      from: "2026-01-01",
      to: "2026-12-01",
    });
    expect(presetRange("last_year", TODAY, FIRST)).toEqual({
      from: "2025-01-01",
      to: "2025-12-01",
    });
    expect(presetRange("all_dates", TODAY, FIRST)).toEqual({
      from: "2026-11-01",
      to: "2036-11-01",
    });
  });
  it("wraps the year", () => {
    expect(presetRange("last_month", "2027-01-10", FIRST)).toEqual({
      from: "2026-12-01",
      to: "2026-12-01",
    });
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
  });
});

describe("yearOptions", () => {
  it("lists 2025 to 2036 for a first month of 2026-11", () => {
    const y = yearOptions(FIRST, TODAY);
    expect(y[0]).toBe(2025);
    expect(y.at(-1)).toBe(2036);
    expect(y).toHaveLength(12);
  });
  it("starts at the first year when it is older", () => {
    expect(yearOptions("2019-03-01", TODAY)[0]).toBe(2019);
  });
});

describe("registerVisible", () => {
  const rows = [
    { date: "2026-11-02", cleared: "cleared" },
    { date: "2026-09-02", cleared: "uncleared" },
    { date: "2026-11-03", cleared: "reconciled" },
  ];
  const base = { ...VIEW_DEFAULTS };
  it("hides reconciled rows unless asked", () => {
    expect(registerVisible(rows, base, TODAY, FIRST, false)).toMatchObject({ hidden: 1 });
    expect(
      registerVisible(rows, { ...base, show_reconciled: true }, TODAY, FIRST, false).hidden,
    ).toBe(0);
  });
  it("hides rows outside the range", () => {
    const s = { ...base, show_reconciled: true, preset: "this_month" as const };
    const r = registerVisible(rows, s, TODAY, FIRST, false);
    expect(r.rows.map((x) => x.date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(r.hidden).toBe(1);
  });
  it("keeps an out-of-range row in reconcile mode but still hides a reconciled one", () => {
    const s = { ...base, preset: "this_month" as const };
    const r = registerVisible(rows, s, TODAY, FIRST, true);
    expect(r.rows.map((x) => x.date)).toEqual(["2026-11-02", "2026-09-02"]);
  });
  it("hides every row when From is later than To", () => {
    const s = {
      ...base,
      show_reconciled: true,
      preset: "custom" as const,
      range_from: "2026-12-01",
      range_to: "2026-10-01",
    };
    expect(registerVisible(rows, s, TODAY, FIRST, false).rows).toEqual([]);
    expect(effectiveRange(s, TODAY, FIRST)).toEqual({ from: "2026-12-01", to: "2026-10-01" });
  });
});

describe("mergeViewSettings", () => {
  it("a non-custom preset clears the range", () => {
    const cur = {
      ...VIEW_DEFAULTS,
      preset: "custom" as const,
      range_from: "2026-01-01",
      range_to: "2026-02-01",
    };
    expect(mergeViewSettings(cur, { preset: "this_year" })).toMatchObject({
      preset: "this_year",
      range_from: null,
      range_to: null,
    });
  });
  it("a range alone means custom; custom needs both months", () => {
    expect(
      mergeViewSettings(VIEW_DEFAULTS, { range_from: "2026-01-01", range_to: "2026-02-01" }),
    ).toMatchObject({ preset: "custom" });
    expect(mergeViewSettings(VIEW_DEFAULTS, { range_from: "2026-01-01" })).toHaveProperty("error");
    expect(mergeViewSettings(VIEW_DEFAULTS, { preset: "custom" })).toHaveProperty("error");
  });
  it("refuses a preset with a range", () => {
    expect(
      mergeViewSettings(VIEW_DEFAULTS, { preset: "this_month", range_from: "2026-01-01" }),
    ).toHaveProperty("error");
  });
  it("merges flags", () => {
    expect(mergeViewSettings(VIEW_DEFAULTS, { show_flags: false })).toMatchObject({
      show_flags: false,
      preset: "all_dates",
    });
  });
});
