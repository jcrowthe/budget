import { describe, expect, it } from "vitest";
import {
  CREATE_DEBT_TARGET,
  DEBT_TARGET_TITLE,
  debtDraftToBody,
  debtTargetHeading,
  durationText,
  EVERY_OPTIONS,
  interestLabel,
  NO_PAYMENTS_YET,
  newDebtDraft,
  paidThisMonthText,
  pairedWithText,
} from "../src/debt-target";
import { DEFAULT_FORMATTER } from "../src/plan-formats";
import { TargetType } from "../src/targets";

// EXF-545: copy and draft of the Debt Payment Target, as plain data.

const fmt = DEFAULT_FORMATTER;

describe("debt target copy", () => {
  it.each([
    [360, "30 years"],
    [359, "29 yrs, 11 mos"],
    [357, "29 yrs, 9 mos"],
    [47, "3 yrs, 11 mos"],
    [10, "10 months"],
    [1, "1 month"],
    [12, "1 year"],
    [13, "1 yr, 1 mo"],
    [null, "—"],
  ])("durationText(%s)", (n, text) => {
    expect(durationText(n)).toBe(text);
  });
  it("the saved heading", () => {
    const def = { amount: 1500000, day_of_month: null };
    expect(debtTargetHeading(def, fmt)).toEqual({
      label: "Monthly Debt Payment",
      heading: "$1,500.00",
      subheading: "Needed Each Month",
      by: "By the End of the Month",
    });
    expect(debtTargetHeading({ ...def, day_of_month: 15 }, fmt).by).toBe(
      "By the 15th of the Month",
    );
  });
  it("the Every options", () => {
    expect(EVERY_OPTIONS).toHaveLength(32);
    expect(EVERY_OPTIONS[0]).toEqual({ value: "last", label: "Last Day of Month" });
    expect(EVERY_OPTIONS[1]).toEqual({ value: 1, label: "1st" });
    expect(EVERY_OPTIONS[31]).toEqual({ value: 31, label: "31st" });
  });
  it("the draft maps to a body", () => {
    expect(debtDraftToBody({ amount: 1500000, day: "last" }, fmt)).toEqual({
      body: { type: "debt_payment", amount: 1500000, day: "last" },
    });
    expect(debtDraftToBody({ amount: 1500000, day: 15 }, fmt)).toEqual({
      body: { type: "debt_payment", amount: 1500000, day: 15 },
    });
    expect(debtDraftToBody({ amount: 0, day: "last" }, fmt)).toEqual({
      errors: { amount: "Enter an amount greater than $0.00." },
    });
    expect(newDebtDraft(1500000)).toEqual({ amount: 1500000, day: "last" });
  });
  it("the strings", () => {
    expect(pairedWithText("ZZ-TEST Mortgage")).toBe("Paired with ZZ-TEST Mortgage Account");
    expect(paidThisMonthText(1500000, fmt)).toBe("$1,500.00 paid this month");
    expect(NO_PAYMENTS_YET).toBe("No payments recorded yet");
    expect(CREATE_DEBT_TARGET).toBe("Create Debt Payment Target");
    expect(DEBT_TARGET_TITLE).toBe("Debt Payment Target");
    expect(interestLabel("6")).toBe("Interest (6%)");
  });
  it("the type is in the schema's TargetType", () => {
    expect(TargetType.options).toContain("debt_payment");
  });
});
