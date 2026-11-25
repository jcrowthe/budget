import { describe, expect, it } from "vitest";
import {
  CURRENT_TRACK_TARGET_TIP,
  CURRENT_TRACK_TIP,
  durationText,
  LoanPairingRequest,
  LoanSummaryQuery,
  ORIGINAL_SCHEDULE_TIP,
  payoffLabel,
  progressLine,
  rateLabel,
  trackSentence,
} from "../src/loan-summary";

const fmt = (n: number) => `$${(n / 1000).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const whole = (n: number) => "$" + Math.round(n / 1000).toLocaleString("en-US");
const text = (s: { text: string }[]) => s.map((x) => x.text).join("");

describe("loan summary copy", () => {
  it("duration text (the ticket's five cases and the singular forms)", () => {
    expect([360, 359, 357, 47, 10].map(durationText)).toEqual([
      "30 years",
      "29 yrs, 11 mos",
      "29 yrs, 9 mos",
      "3 yrs, 11 mos",
      "10 months",
    ]);
    expect(durationText(12)).toBe("1 year");
    expect(durationText(1)).toBe("1 month");
    expect(durationText(13)).toBe("1 yr, 1 mo");
    expect(durationText(0)).toBe("0 months");
  });
  it("rate and payoff labels", () => {
    expect(rateLabel("6")).toBe("6%");
    expect(rateLabel("4.5")).toBe("4.5%");
    expect(rateLabel("0")).toBe("0%");
    expect(rateLabel(null)).toBe("—");
    expect(payoffLabel("2056-11-01")).toBe("Nov 2056");
    expect(payoffLabel(null)).toBe("—");
  });
  it("progress line is whole currency with one decimal", () => {
    expect(progressLine(200000000, 100, whole)).toBe("Balance Remaining $200,000 (100.0%)");
    expect(progressLine(199800000, 99.9, whole)).toBe("Balance Remaining $199,800 (99.9%)");
    expect(progressLine(5000, null, whole)).toBe("Balance Remaining $5");
  });
  it("track sentences", () => {
    const min = trackSentence({ source: "minimum", payment: 1500000, n: 360 }, fmt);
    expect(text(min)).toBe("The minimum payment of $1,500.00 will pay off this loan in 30 years");
    expect(min.filter((s) => s.bold).map((s) => s.text)).toEqual(["$1,500.00", "30 years"]);
    expect(text(trackSentence({ source: "target", payment: 1500000, n: 359 }, fmt))).toBe(
      "Your monthly target of $1,500.00 keeps you on track to pay off this loan in 29 yrs, 11 mos",
    );
    expect(text(trackSentence({ source: "minimum", payment: 1300000, n: null }, fmt))).toBe(
      "The minimum payment of $1,300.00 won't pay off this loan",
    );
    expect(text(trackSentence({ source: "target", payment: 1300000, n: null }, fmt))).toBe(
      "Your monthly target of $1,300.00 won't pay off this loan",
    );
    expect(text(trackSentence({ source: "minimum", payment: 1, n: 0 }, fmt))).toBe(
      "This loan is paid off",
    );
  });
  it("legend tips are the ticket's text", () => {
    expect(ORIGINAL_SCHEDULE_TIP).toBe(
      "Estimated balance based on paying the minimum since the start of the loan. You can change the starting point by clicking into any Past Balance in the chart.",
    );
    expect(CURRENT_TRACK_TIP).toBe(
      "Estimated future balance if you pay the minimum required amount due per payment period.",
    );
    expect(CURRENT_TRACK_TARGET_TIP).toBe(
      "Estimated future balance if you pay your paired category’s target amount every payment period.",
    );
  });
  it("query and pairing body", () => {
    expect(LoanSummaryQuery.parse({}).month).toBeUndefined();
    expect(LoanSummaryQuery.safeParse({ month: "2026-11-15" }).success).toBe(false);
    expect(LoanPairingRequest.safeParse({ category_id: "" }).success).toBe(false);
    expect(LoanPairingRequest.safeParse({ category_id: "x", extra: 1 }).success).toBe(false);
    expect(LoanPairingRequest.safeParse({ category_id: "x" }).success).toBe(true);
  });
});
