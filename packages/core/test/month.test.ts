import { describe, expect, it } from "vitest";
import { addMonths, currentMonth, isMonth, monthKey, toMonth } from "../src/month";

describe("month", () => {
  it("maps a date to its first day", () => {
    expect(toMonth("2026-11-15")).toBe("2026-11-01");
  });
  it("uses UTC for the current month", () => {
    expect(currentMonth(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11-01");
  });
  it("rolls over years in both directions", () => {
    expect(addMonths("2026-11-01", 2)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-01-01", 24)).toBe("2028-01-01");
  });
  it("keys and validates", () => {
    expect(monthKey("2026-11-01")).toBe("202611");
    expect(isMonth("2026-11-01")).toBe(true);
    expect(isMonth("2026-11-15")).toBe(false);
    expect(isMonth("2026-13-01")).toBe(false);
  });
});
