import { describe, expect, it } from "vitest";
import { loanPayoff, MAX_PAYOFF_MONTHS, paymentForMonths } from "../src/debt-targets";
import type { LoanTerms } from "../src/loan-engine";
import { MAX_PROJECTION_MONTHS, projectLoan } from "../src/loan-projection";

// EXF-541 / EXF-545: one payoff arithmetic. projectLoan and loanPayoff give the same count, month and interest.
const M = (n: number) => n * 1000;
const FROM = "2026-11-01";
const mortgage: LoanTerms = { type: "mortgage", interest_rate: "6", escrow_amount: M(300) };
const auto: LoanTerms = { type: "autoLoan", interest_rate: "4.5", escrow_amount: null };

const cases: [string, LoanTerms, number, number][] = [
  ["200,000 @ 6%, escrow 300, 1,500", mortgage, 200000, 1500],
  ["199,500 @ 6%, escrow 300, 1,500", mortgage, 199500, 1500],
  ["15,000 @ 4.5%, 350", auto, 15000, 350],
  ["never pays off", mortgage, 200000, 1300],
  ["paid off", auto, 0, 350],
];

describe("projectLoan and loanPayoff agree", () => {
  for (const [name, terms, owed, pay] of cases) {
    it(name, () => {
      const p = projectLoan(terms, { balance: M(owed), payment: M(pay), from: FROM });
      const l = loanPayoff({
        owed: M(owed),
        rate: terms.interest_rate,
        payment: M(pay),
        escrow: terms.type === "mortgage" ? (terms.escrow_amount ?? 0) : 0,
      });
      expect(l.months).toBe(p.payments_remaining);
      expect(l.interest).toBe(p.interest_total);
      expect(l.total).toBe(M(owed) + p.interest_total);
    });
  }
  it("the first example is 360 payments and the second 47", () => {
    expect(
      projectLoan(mortgage, { balance: M(200000), payment: M(1500), from: FROM }),
    ).toMatchObject({ payments_remaining: 360, payoff_month: "2056-11-01" });
    expect(projectLoan(auto, { balance: M(15000), payment: M(350), from: FROM })).toMatchObject({
      payments_remaining: 47,
      payoff_month: "2030-10-01",
    });
  });
  it("one maximum, and paymentForMonths pays off in time under projectLoan", () => {
    expect(MAX_PAYOFF_MONTHS).toBe(MAX_PROJECTION_MONTHS);
    const pay = paymentForMonths({ owed: M(15000), rate: "4.5", escrow: 0 }, 36);
    const p = projectLoan(auto, { balance: M(15000), payment: pay, from: FROM });
    expect(p.payments_remaining).toBeLessThanOrEqual(36);
  });
});
