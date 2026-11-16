import { describe, expect, it } from "vitest";
import {
  addMonths,
  dateKeyAction,
  formatEntryDate,
  monthGrid,
  monthTitle,
  parseEntryDate,
} from "../src/date-entry";

const TODAY = "2026-11-15";
const key = (k: string, base = TODAY) => dateKeyAction(k, base, TODAY);

describe("dateKeyAction", () => {
  it("follows the EXF-517 table from 2026-11-15", () => {
    expect(key("m")).toBe("2026-11-01");
    expect(key("M")).toBe("2026-11-30");
    expect(key("y")).toBe("2026-01-01");
    expect(key("r")).toBe("2026-12-31");
    expect(key("Y")).toBe("2026-12-31");
    expect(key("-", key("-") as string)).toBe("2026-11-13");
    expect(key("+", key("+") as string)).toBe("2026-11-17");
    expect(key("=")).toBe("2026-11-16");
    expect(key("ArrowDown")).toBe("2026-11-22");
    expect(key("ArrowUp")).toBe("2026-11-08");
    expect(key("t", "2020-01-01")).toBe(TODAY);
  });
  it("crosses month and year ends", () => {
    expect(key("+", "2026-01-31")).toBe("2026-02-01");
    expect(key("M", "2028-02-10")).toBe("2028-02-29");
    expect(key("+", "2026-12-31")).toBe("2027-01-01");
    expect(key("-", "2026-01-01")).toBe("2025-12-31");
  });
  it("is null for other keys", () => {
    expect(key("a")).toBeNull();
    expect(key("1")).toBeNull();
    expect(key("Enter")).toBeNull();
  });
});

describe("parseEntryDate", () => {
  it.each([
    ["11/3", "2026-11-03"],
    ["1/2/27", "2027-01-02"],
    ["3", "2026-03-01"],
    ["11/15/2026", "2026-11-15"],
    ["2026-11-15", "2026-11-15"],
    ["1-2-2027", "2027-01-02"],
    ["1.2.27", "2027-01-02"],
    [" 11/3 ", "2026-11-03"],
  ])("%s", (text, want) => expect(parseEntryDate(text, TODAY)).toBe(want));
  it.each(["garbage", "2/30", "13/1", "", "0/1", "1/2/3", "1/2/1800", "1//2", "1/2/3/4"])(
    "refuses %j",
    (text) => expect(parseEntryDate(text, TODAY)).toBeNull(),
  );
});

describe("formatting and the grid", () => {
  it("formats", () => {
    expect(formatEntryDate("2026-11-03")).toBe("11/03/2026");
    expect(monthTitle("2026-11-01")).toBe("Nov 2026");
    expect(addMonths("2026-11-01", 2)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });
  it("starts Nov 2026 on a Sunday", () => {
    const g = monthGrid("2026-11-01");
    expect(g[0]?.[0]).toBe("2026-11-01");
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
  });
  it("pads a month that starts midweek", () => {
    const g = monthGrid("2026-12-01");
    expect(g[0]?.slice(0, 3)).toEqual([null, null, "2026-12-01"]);
  });
});
