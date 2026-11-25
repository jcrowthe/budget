import { describe, expect, it } from "vitest";
import {
  DEBT_TARGET_TYPE,
  debtTargetFields,
  isDebtTargetDef,
  loanPayoff,
  paymentForMonths,
} from "../src/debt-targets";

// EXF-545: the Debt Payment Target of a loan's paired category. Integer milliunits; the ticket's mortgage is
// 200,000.00 at 6% with a 1,500.00 payment of which 300.00 is escrow.

const MORTGAGE = { owed: 200000000, rate: "6", payment: 1500000, escrow: 300000 };

describe("debtTargetFields", () => {
  it("stores a monthly set-aside, the last day as a null day_of_month", () => {
    expect(DEBT_TARGET_TYPE).toBe("debt_payment");
    expect(debtTargetFields(1500000, "last")).toEqual({
      cadence: "monthly",
      behavior: "set_aside",
      amount: 1500000,
      day_of_month: null,
      day_of_week: null,
      due_date: null,
      due_month: null,
      repeat: null,
    });
    expect(debtTargetFields(1500000, 15).day_of_month).toBe(15);
  });
  it("isDebtTargetDef is true only for a monthly set-aside", () => {
    const def = { cadence: "monthly", behavior: "set_aside" } as const;
    expect(isDebtTargetDef(def)).toBe(true);
    expect(isDebtTargetDef({ cadence: "monthly", behavior: "refill" })).toBe(false);
    expect(isDebtTargetDef({ cadence: "weekly", behavior: "set_aside" })).toBe(false);
    expect(isDebtTargetDef({ cadence: "custom", behavior: "balance" })).toBe(false);
  });
});

describe("loanPayoff", () => {
  it("the ticket's 30-year mortgage: 360 payments", () => {
    const p = loanPayoff(MORTGAGE);
    expect(p.months).toBe(360);
    expect(Math.abs(p.interest - 231096440)).toBeLessThanOrEqual(1000);
    expect(p.total).toBe(MORTGAGE.owed + p.interest);
  });
  it("a smaller balance pays off sooner", () => {
    expect(loanPayoff({ ...MORTGAGE, owed: 199800000 }).months).toBe(359);
    expect(loanPayoff({ ...MORTGAGE, owed: 199500000 }).months).toBe(357);
  });
  it("other loans", () => {
    expect(loanPayoff({ owed: 15000000, rate: "4.5", payment: 350000, escrow: 0 }).months).toBe(47);
    expect(loanPayoff({ owed: 1000000, rate: "0", payment: 100000, escrow: 0 }).months).toBe(10);
  });
  it("a payment that does not cover the first month's interest never pays off", () => {
    // interest on 200,000 at 6% is 1,000.00 a month; P&I 1,000.00 does not reduce the balance
    const p = loanPayoff({ owed: 200000000, rate: "6", payment: 1300000, escrow: 300000 });
    expect(p.months).toBeNull();
    expect(loanPayoff({ ...MORTGAGE, payment: 1000000 }).months).toBeNull();
  });
});

describe("paymentForMonths", () => {
  it.each([
    [MORTGAGE.owed, "6", 300000, 240],
    [MORTGAGE.owed, "6", 300000, 120],
    [15000000, "4.5", 0, 24],
    [1000000, "0", 0, 7],
  ])("the smallest payment for %i at %s%% in %i months", (owed, rate, escrow, k) => {
    const payment = paymentForMonths({ owed, rate, escrow }, k);
    const at = loanPayoff({ owed, rate, payment, escrow }).months;
    expect(at).not.toBeNull();
    expect(at as number).toBeLessThanOrEqual(k);
    // to the cent: P&I is a multiple of 10 milliunits, and one cent less is too slow
    expect((payment - escrow) % 10).toBe(0);
    const less = loanPayoff({ owed, rate, payment: payment - 10, escrow }).months;
    expect(less === null || less > k).toBe(true);
  });
});
