import { describe, expect, it } from "vitest";
import { type LoanTerms, runLoan } from "../src/loan-engine";
import { MAX_PROJECTION_MONTHS, projectLoan } from "../src/loan-projection";

const NOV = "2026-11-01";
const M = (n: number) => n * 1000;
const mortgage: LoanTerms = { type: "mortgage", interest_rate: "6", escrow_amount: M(300) };
const auto: LoanTerms = { type: "autoLoan", interest_rate: "4.5", escrow_amount: null };
const medical: LoanTerms = { type: "medicalDebt", interest_rate: "0", escrow_amount: null };

describe("projectLoan: the ticket's five cases", () => {
  const cases: [string, LoanTerms, number, number, number, string, string][] = [
    ["200,000 mortgage", mortgage, 200000, 1500, 360, "2056-11-01", "30 years"],
    ["199,800 mortgage", mortgage, 199800, 1500, 359, "2056-10-01", "29 yrs, 11 mos"],
    ["199,500 mortgage", mortgage, 199500, 1500, 357, "2056-08-01", "29 yrs, 9 mos"],
    ["auto", auto, 15000, 350, 47, "2030-10-01", "3 yrs, 11 mos"],
    ["medical", medical, 1000, 100, 10, "2027-09-01", "10 months"],
  ];
  for (const [name, terms, bal, pay, n, payoff, text] of cases) {
    it(name, () => {
      const p = projectLoan(terms, { balance: M(bal), payment: M(pay), from: NOV });
      expect(p.payments_remaining).toBe(n);
      expect(p.payoff_month).toBe(payoff);
      expect(p.schedule[0]).toEqual({ month: NOV, balance: M(bal) });
      expect(p.schedule.at(-1)).toEqual({ month: payoff, balance: 0 });
      expect(p.schedule).toHaveLength(n + 1);
    });
  }
});

describe("projectLoan agrees with runLoan", () => {
  it("the first projected month equals the engine's November for the EXF-540 mortgage", () => {
    const [nov] = runLoan(mortgage, [
      {
        month: NOV,
        payments: M(1500),
        starting: -M(200000),
        other: 0,
        interest_rows: null,
        escrow_rows: null,
      },
    ]);
    expect(nov?.interest?.amount).toBe(-M(1000));
    expect(nov?.escrow?.amount).toBe(-M(300));
    expect(nov?.principal).toBe(M(200));
    expect(nov?.closing).toBe(-M(199800));
    const p = projectLoan(mortgage, { balance: M(200000), payment: M(1500), from: NOV });
    expect(p.schedule[1]).toEqual({ month: "2026-12-01", balance: -(nov?.closing ?? 0) });
    const q = projectLoan(mortgage, { balance: M(199800), payment: M(1500), from: NOV });
    expect(q.payments_remaining).toBe(359);
    expect(q.payoff_month).toBe("2056-10-01");
  });
  it("interest totals", () => {
    const a = projectLoan(mortgage, { balance: M(200000), payment: M(1500), from: NOV });
    expect(Math.abs(a.interest_total - 231096440)).toBeLessThanOrEqual(1000);
    const b = projectLoan(mortgage, { balance: M(199500), payment: M(1500), from: NOV });
    expect(Math.abs(b.interest_total - 228607580)).toBeLessThanOrEqual(1000);
  });
  it("a 2,000 payment from 199,500", () => {
    const p = projectLoan(mortgage, { balance: M(199500), payment: M(2000), from: NOV });
    expect(p.payments_remaining).toBe(178);
    expect(p.payoff_month).toBe("2041-09-01");
  });
});

describe("projectLoan edges", () => {
  it("never pays off when the payment does not cover interest and escrow", () => {
    const p = projectLoan(mortgage, { balance: M(200000), payment: M(1300), from: NOV });
    expect(p.payments_remaining).toBeNull();
    expect(p.payoff_month).toBeNull();
    expect(p.interest_total).toBe(0);
    expect(p.schedule).toEqual([{ month: NOV, balance: M(200000) }]);
  });
  it("no payment never pays off", () => {
    expect(
      projectLoan(auto, { balance: M(100), payment: 0, from: NOV }).payments_remaining,
    ).toBeNull();
  });
  it("a zero balance is paid off this month", () => {
    const p = projectLoan(mortgage, { balance: 0, payment: M(1500), from: NOV });
    expect(p.payments_remaining).toBe(0);
    expect(p.payoff_month).toBe(NOV);
    expect(p.schedule).toEqual([{ month: NOV, balance: 0 }]);
  });
  it("a null rate is 0%", () => {
    const p = projectLoan(
      { ...medical, interest_rate: null },
      { balance: M(1000), payment: M(100), from: NOV },
    );
    expect(p.payments_remaining).toBe(10);
    expect(p.interest_total).toBe(0);
  });
  it("a non-mortgage ignores escrow_amount", () => {
    const withEscrow = { ...auto, escrow_amount: M(300) };
    expect(projectLoan(withEscrow, { balance: M(15000), payment: M(350), from: NOV })).toEqual(
      projectLoan(auto, { balance: M(15000), payment: M(350), from: NOV }),
    );
  });
  it("the schedule ends at 0 and never rises", () => {
    const s = projectLoan(mortgage, { balance: M(200000), payment: M(1500), from: NOV }).schedule;
    expect(s.at(-1)?.balance).toBe(0);
    for (let i = 1; i < s.length; i++)
      expect(s[i]?.balance).toBeLessThanOrEqual(s[i - 1]?.balance ?? 0);
  });
  it("stops at the maximum", () => {
    const slow: LoanTerms = { type: "otherDebt", interest_rate: "0", escrow_amount: null };
    const p = projectLoan(slow, { balance: M(1000000), payment: M(1), from: NOV });
    expect(p.payments_remaining).toBeNull();
    expect(p.schedule.length).toBeLessThanOrEqual(MAX_PROJECTION_MONTHS + 1);
  });
});
