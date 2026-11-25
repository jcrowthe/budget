import { describe, expect, it } from "vitest";
import {
  occurrencesInMonth,
  type UpcomingSource,
  upcomingByCategory,
  upcomingList,
} from "../src/scheduled-upcoming";

const NOV = "2026-11-01";
const DEC = "2026-12-01";

function src(over: Partial<UpcomingSource> = {}): UpcomingSource {
  return {
    id: "s1",
    category_id: "c1",
    account_id: "a1",
    account_name: "Checking",
    date_first: "2026-11-22",
    date_next: "2026-11-22",
    frequency: "weekly",
    amount: -20_000,
    payee_id: null,
    payee_name: null,
    memo: null,
    ...over,
  };
}

describe("occurrencesInMonth", () => {
  it("weekly -20 next 11/22: November has 11/22 and 11/29", () => {
    expect(occurrencesInMonth(src(), NOV)).toEqual(["2026-11-22", "2026-11-29"]);
  });
  it("December has four, and November's are not carried", () => {
    expect(occurrencesInMonth(src(), DEC)).toEqual([
      "2026-12-06",
      "2026-12-13",
      "2026-12-20",
      "2026-12-27",
    ]);
  });
  it("a date_next in a later month gives none for an earlier month", () => {
    expect(
      occurrencesInMonth(src({ date_first: "2026-12-10", date_next: "2026-12-10" }), NOV),
    ).toEqual([]);
  });
  it("an overdue occurrence inside the month counts", () => {
    const s = src({ date_first: "2026-11-03", date_next: "2026-11-03", frequency: "never" });
    expect(occurrencesInMonth(s, NOV)).toEqual(["2026-11-03"]);
  });
  it("monthly from the 31st clamps into February", () => {
    const s = src({ date_first: "2026-12-31", date_next: "2026-12-31", frequency: "monthly" });
    expect(occurrencesInMonth(s, "2027-02-01")).toEqual(["2027-02-28"]);
  });
  it("a one-off gives at most one date", () => {
    const s = src({ frequency: "never" });
    expect(occurrencesInMonth(s, NOV)).toEqual(["2026-11-22"]);
    expect(occurrencesInMonth(s, DEC)).toEqual([]);
  });
  it("daily gives every day to the 30th and 31st", () => {
    const s = src({ date_first: "2026-11-01", date_next: "2026-11-01", frequency: "daily" });
    expect(occurrencesInMonth(s, NOV)).toHaveLength(30);
    expect(occurrencesInMonth(s, DEC)).toHaveLength(31);
  });
  it("twice a month gives two dates", () => {
    const s = src({ date_first: "2026-11-05", date_next: "2026-11-05", frequency: "twiceAMonth" });
    expect(occurrencesInMonth(s, NOV)).toEqual(["2026-11-05", "2026-11-20"]);
    expect(occurrencesInMonth(s, DEC)).toEqual(["2026-12-05", "2026-12-20"]);
  });
});

describe("upcomingByCategory", () => {
  it("sums amounts and counts occurrences per category", () => {
    const m = upcomingByCategory([src(), src({ id: "s2", category_id: "c2", amount: 5_000 })], NOV);
    expect(m.get("c1")).toEqual({ upcoming: -40_000, upcoming_count: 2 });
    expect(m.get("c2")).toEqual({ upcoming: 10_000, upcoming_count: 2 });
  });
  it("omits categories with nothing in the month", () => {
    expect(upcomingByCategory([src()], "2026-10-01").size).toBe(0);
  });
});

describe("upcomingList", () => {
  it("is latest date first, ties by account name then id", () => {
    const rows = upcomingList(
      [
        src({ id: "s2", account_name: "Zed", frequency: "never" }),
        src({ id: "s3", account_name: "Amy", frequency: "never" }),
        src({ id: "s1", account_name: "Amy", frequency: "never" }),
        src({ id: "s4", category_id: "other", frequency: "never" }),
      ],
      "c1",
      NOV,
    );
    expect(rows.map((r) => r.scheduled_transaction_id)).toEqual(["s1", "s3", "s2"]);
  });
  it("weekly lists 11/29 before 11/22", () => {
    expect(upcomingList([src()], "c1", NOV).map((r) => r.date)).toEqual([
      "2026-11-29",
      "2026-11-22",
    ]);
  });
});
