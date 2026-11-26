import { describe, expect, it } from "vitest";
import { futureMonthLabel } from "./futureAssigned";

describe("futureMonthLabel", () => {
  const C = "2026-11-01";
  it("names the month, and adds the year from 12 months ahead", () => {
    expect(futureMonthLabel("2026-12-01", C)).toBe("December");
    expect(futureMonthLabel("2027-01-01", C)).toBe("January");
    expect(futureMonthLabel("2027-10-01", C)).toBe("October");
    expect(futureMonthLabel("2027-11-01", C)).toBe("November 2027");
    expect(futureMonthLabel("2027-12-01", C)).toBe("December 2027");
  });
});
