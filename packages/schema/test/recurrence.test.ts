import { describe, expect, it } from "vitest";
import {
  dayBefore,
  dueStep,
  FREQUENCIES,
  FREQUENCY_LABELS,
  nextDate,
  occurrenceAfter,
  placeSchedule,
  repeatTooltip,
  savesAsScheduled,
} from "../src/recurrence";

/** The dates a series visits, one step at a time, from its anchor. */
function walk(anchor: string, f: Parameters<typeof nextDate>[1], steps: number): string[] {
  const out: string[] = [];
  let cur = anchor;
  for (let i = 0; i < steps; i++) {
    const n = nextDate(anchor, f, cur);
    if (!n) break;
    out.push(n);
    cur = n;
  }
  return out;
}

describe("recurrence", () => {
  it("weekly from 2026-11-15 is 2026-11-22", () => {
    expect(nextDate("2026-11-15", "weekly", "2026-11-15")).toBe("2026-11-22");
  });
  it("monthly from 2026-12-31 keeps the start day", () => {
    expect(walk("2026-12-31", "monthly", 4)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });
  it("monthly from 2028-01-31 reaches 2028-02-29 (leap year)", () => {
    expect(nextDate("2028-01-31", "monthly", "2028-01-31")).toBe("2028-02-29");
  });
  it("twice a month from the 20th: the 5th and the 20th", () => {
    expect(walk("2026-11-20", "twiceAMonth", 4)).toEqual([
      "2026-12-05",
      "2026-12-20",
      "2027-01-05",
      "2027-01-20",
    ]);
  });
  it("twice a month from the 10th: the 25th and the 10th (decided by the Lead)", () => {
    expect(walk("2026-12-10", "twiceAMonth", 2)).toEqual(["2026-12-25", "2027-01-10"]);
  });
  it("twice a month from the 31st: the 16th and the month's end (decided)", () => {
    expect(walk("2027-01-31", "twiceAMonth", 4)).toEqual([
      "2027-02-16",
      "2027-02-28",
      "2027-03-16",
      "2027-03-31",
    ]);
  });
  it("yearly from 2028-02-29 clamps, then returns to the 29th", () => {
    expect(walk("2028-02-29", "yearly", 4)).toEqual([
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });
  it("every other year from 2028-02-29", () => {
    expect(walk("2028-02-29", "everyOtherYear", 2)).toEqual(["2030-02-28", "2032-02-29"]);
  });
  it("daily", () => expect(nextDate("2026-12-31", "daily", "2026-12-31")).toBe("2027-01-01"));
  it("every other week", () =>
    expect(nextDate("2026-11-15", "everyOtherWeek", "2026-11-15")).toBe("2026-11-29"));
  it("every 4 weeks", () =>
    expect(nextDate("2026-11-15", "every4Weeks", "2026-11-15")).toBe("2026-12-13"));
  it("every other month", () =>
    expect(nextDate("2026-11-30", "everyOtherMonth", "2026-11-30")).toBe("2027-01-30"));
  it("every 3 months", () =>
    expect(nextDate("2026-11-30", "every3Months", "2026-11-30")).toBe("2027-02-28"));
  it("every 4 months", () =>
    expect(nextDate("2026-11-30", "every4Months", "2026-11-30")).toBe("2027-03-30"));
  it("twice a year", () =>
    expect(nextDate("2026-12-31", "twiceAYear", "2026-12-31")).toBe("2027-06-30"));
  it("the first occurrence strictly after a day", () => {
    expect(occurrenceAfter("2026-11-01", "weekly", "2026-11-15")).toBe("2026-11-22");
    expect(occurrenceAfter("2026-11-01", "weekly", "2026-11-22")).toBe("2026-11-29");
  });
  it("an anchor after `after` is returned", () => {
    for (const f of FREQUENCIES)
      expect(occurrenceAfter("2026-12-01", f, "2026-11-15")).toBe("2026-12-01");
  });
  it("never has only its anchor", () => {
    expect(occurrenceAfter("2026-11-20", "never", "2026-11-15")).toBe("2026-11-20");
    expect(occurrenceAfter("2026-11-20", "never", "2026-11-20")).toBeNull();
  });
  it("every frequency steps strictly forward", () => {
    for (const f of FREQUENCIES.filter((x) => x !== "never")) {
      const [a, b] = walk("2026-01-31", f, 2);
      expect(a && b && a < b && a > "2026-01-31").toBe(true);
    }
  });
  it("the labels and the tooltip", () => {
    expect(FREQUENCIES.map((f) => FREQUENCY_LABELS[f])).toEqual([
      "Never",
      "Daily",
      "Weekly",
      "Every other week",
      "Twice a month",
      "Every 4 weeks",
      "Monthly",
      "Every other month",
      "Every 3 months",
      "Every 4 months",
      "Twice a year",
      "Yearly",
      "Every other year",
    ]);
    expect(repeatTooltip("monthly")).toBe("Repeats monthly");
    expect(repeatTooltip("everyOtherMonth")).toBe("Repeats every other month");
    expect(repeatTooltip("never")).toBeNull();
  });
  it("savesAsScheduled", () => {
    expect(savesAsScheduled("2026-11-16", "never", "2026-11-15")).toBe(true);
    expect(savesAsScheduled("2026-11-15", "weekly", "2026-11-15")).toBe(true);
    expect(savesAsScheduled("2026-11-15", "never", "2026-11-15")).toBe(false);
  });
  it("placeSchedule: a future date is a schedule", () => {
    expect(placeSchedule("2026-12-01", "never", "2026-11-30")).toEqual({
      kind: "schedule",
      dateNext: "2026-12-01",
    });
  });
  it("placeSchedule: a past date with a repeat enters one row (month and year ends)", () => {
    expect(placeSchedule("2026-11-30", "weekly", "2026-11-30")).toEqual({
      kind: "enterAndSchedule",
      enterDate: "2026-11-30",
      dateNext: "2026-12-07",
    });
    expect(placeSchedule("2026-12-31", "monthly", "2026-12-31")).toEqual({
      kind: "enterAndSchedule",
      enterDate: "2026-12-31",
      dateNext: "2027-01-31",
    });
    expect(placeSchedule("2026-11-01", "weekly", "2026-11-15")).toEqual({
      kind: "enterAndSchedule",
      enterDate: "2026-11-01",
      dateNext: "2026-11-22",
    });
  });
  it("placeSchedule: today or earlier with Never is not scheduled", () => {
    expect(placeSchedule("2026-11-15", "never", "2026-11-15")).toEqual({ kind: "notScheduled" });
  });
  it("dueStep: a missed run enters the first date and skips the rest", () => {
    expect(dueStep("2026-10-01", "weekly", "2026-10-01", "2026-11-15")).toEqual({
      enterDate: "2026-10-01",
      dateNext: "2026-11-19",
    });
    expect(dueStep("2026-10-01", "weekly", "2026-11-19", "2026-11-15")).toBeNull();
    expect(dueStep("2026-11-15", "never", "2026-11-15", "2026-11-15")).toEqual({
      enterDate: "2026-11-15",
      dateNext: null,
    });
  });
  it("a daily series ten years back is computed directly", () => {
    expect(occurrenceAfter("2016-11-15", "daily", "2026-11-15")).toBe("2026-11-16");
  });
  it("dayBefore", () => {
    expect(dayBefore("2026-11-17")).toBe("2026-11-16");
    expect(dayBefore("2027-01-01")).toBe("2026-12-31");
    expect(dayBefore("2028-03-01")).toBe("2028-02-29");
  });
});
