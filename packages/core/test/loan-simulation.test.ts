import { describe, expect, it } from "vitest";
import type { LoanTerms } from "../src/loan-engine";
import { type ProjectionIn, projectLoan, simulatePayoff } from "../src/loan-projection";

const NOV = "2026-11-01";
const M = (n: number) => n * 1000;
const mortgage: LoanTerms = { type: "mortgage", interest_rate: "6", escrow_amount: M(300) };
const auto: LoanTerms = { type: "autoLoan", interest_rate: "4.5", escrow_amount: null };
const medical: LoanTerms = { type: "medicalDebt", interest_rate: "0", escrow_amount: null };
const base: ProjectionIn = { balance: M(199500), payment: M(1500), from: NOV };

describe("simulatePayoff: base case", () => {
  const cases: [string, LoanTerms, ProjectionIn][] = [
    ["199,500 mortgage", mortgage, base],
    ["auto", auto, { balance: M(15000), payment: M(350), from: NOV }],
    ["medical", medical, { balance: M(1000), payment: M(100), from: NOV }],
  ];
  for (const [name, terms, b] of cases) {
    it(`${name}: no change equals projectLoan, with zero savings`, () => {
      const sim = simulatePayoff(terms, b, { payment: b.payment, extra_once: 0 });
      expect(sim.projection).toEqual(projectLoan(terms, b));
      expect(sim.interest_savings).toBe(0);
      expect(sim.months_saved).toBe(0);
    });
  }

  it("extra_once 0 changes nothing in projectLoan", () => {
    expect(projectLoan(mortgage, { ...base, extra_once: 0 })).toEqual(projectLoan(mortgage, base));
  });
});

describe("simulatePayoff: the ticket's example", () => {
  it("2,000 a month", () => {
    const sim = simulatePayoff(mortgage, base, { payment: M(2000), extra_once: 0 });
    expect(sim.projection.payments_remaining).toBe(178);
    expect(sim.projection.payoff_month).toBe("2041-09-01");
    expect(sim.months_saved).toBe(179);
    expect(Math.abs(sim.projection.interest_total - 101721520)).toBeLessThanOrEqual(1000);
    expect(Math.abs((sim.interest_savings ?? 0) - 126886060)).toBeLessThanOrEqual(1000);
  });

  it("10,000 once", () => {
    const sim = simulatePayoff(mortgage, base, { payment: M(1500), extra_once: M(10000) });
    expect(sim.projection.payments_remaining).toBe(313);
    expect(sim.projection.payoff_month).toBe("2052-12-01");
    expect(sim.months_saved).toBe(44);
    expect(Math.abs(sim.projection.interest_total - 185276060)).toBeLessThanOrEqual(240000);
    expect(sim.projection.schedule[0]).toEqual({ month: NOV, balance: M(199500) });
    expect(sim.projection.schedule.at(-1)).toEqual({ month: "2052-12-01", balance: 0 });
  });

  it("principal is the balance; remaining to pay is principal + interest", () => {
    const sim = simulatePayoff(mortgage, base, { payment: M(2000), extra_once: 0 });
    expect(sim.principal).toBe(M(199500));
    expect(sim.remaining_to_pay).toBe(M(199500) + sim.projection.interest_total);
  });
});

describe("simulatePayoff: edges", () => {
  it("an extra at least the balance pays off in one payment with no interest", () => {
    const sim = simulatePayoff(mortgage, base, { payment: M(1500), extra_once: M(250000) });
    expect(sim.projection.payments_remaining).toBe(1);
    expect(sim.projection.payoff_month).toBe("2026-12-01");
    expect(sim.projection.interest_total).toBe(0);
    expect(sim.projection.schedule).toEqual([
      { month: NOV, balance: M(199500) },
      { month: "2026-12-01", balance: 0 },
    ]);
  });

  it("a payment that does not cover interest and escrow never pays off, with null savings", () => {
    const sim = simulatePayoff(mortgage, base, { payment: M(500), extra_once: 0 });
    expect(sim.projection.payments_remaining).toBeNull();
    expect(sim.interest_savings).toBeNull();
    expect(sim.months_saved).toBeNull();
  });

  it("a negative extra counts as 0", () => {
    const sim = simulatePayoff(mortgage, base, { payment: M(1500), extra_once: -M(5000) });
    expect(sim.projection).toEqual(projectLoan(mortgage, base));
    expect(sim.months_saved).toBe(0);
  });
});
