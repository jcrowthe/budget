import { env } from "cloudflare:test";
import { simulatePayoff } from "@budget/core/loan-projection";
import { describe, expect, it } from "vitest";
import type { Json } from "./bulk-helpers";
import { json } from "./helpers";
import { MORTGAGE, newPlan, openAccount, send, summary, tool, world } from "./loan-world";
import { apiDocument, apiPaths, listedToolNames } from "./surface";

// EXF-544 follow-up: POST .../accounts/{id}/payoff-simulation and simulate_loan_payoff. Milliunits. Read-only; the
// numbers are simulatePayoff's (the dialog's function) over the loan summary's figures.
const path = (bid: string, loan: string) =>
  `/api/v1/budgets/${bid}/accounts/${loan}/payoff-simulation`;
const simulate = (bid: string, loan: string, body: Json = {}) =>
  send(path(bid, loan), "POST", body);
const data = async (res: Response): Promise<Json> => ((await res.json()) as Json).data;
const mcpData = (res: Json): Json => res.structuredContent ?? JSON.parse(res.content[0].text);

/** The ticket's observed loan: 199,500.00 at 6%, escrow 300.00, minimum 1,500.00. */
async function ticketLoan() {
  const bid = await newPlan();
  const loan = await openAccount(bid, { ...MORTGAGE, balance: 199500000 });
  return { bid, loan };
}

/** simulatePayoff over the summary's figures, as the dialog calls it. */
async function expected(bid: string, loan: Json, payment: number, extra: number) {
  const s = await summary(bid, loan.id, null);
  const sim = simulatePayoff(
    { type: loan.type, interest_rate: s.interest_rate, escrow_amount: s.escrow_amount },
    { balance: s.remaining_balance, payment: s.payment_used, from: s.schedule[0].month },
    { payment, extra_once: extra },
  );
  return { s, sim };
}

describe("payoff simulation: the numbers", () => {
  it("the ticket's worked examples equal simulatePayoff", async () => {
    const { bid, loan } = await ticketLoan();
    for (const [payment, extra, n, saved] of [
      [2000000, 0, 178, 179],
      [1500000, 10000000, 313, 44],
    ] as const) {
      const body = payment === 1500000 ? { extra_once: extra } : { monthly_payment: payment };
      const res = await simulate(bid, loan.id, body);
      expect(res.status).toBe(200);
      const d = await data(res);
      const { s, sim } = await expected(bid, loan, payment, extra);
      expect(s.payments_remaining).toBe(357);
      expect(d).toMatchObject({
        payments_remaining: n,
        months_saved: saved,
        payoff_month: sim.projection.payoff_month,
        interest_total: sim.projection.interest_total,
        interest_savings: sim.interest_savings,
        principal: sim.principal,
        remaining_to_pay: sim.remaining_to_pay,
        monthly_payment: payment,
        extra_once: extra,
        payment_used: 1500000,
      });
      expect(d.schedule).toEqual(sim.projection.schedule);
      expect(d.current).toMatchObject({
        payments_remaining: s.payments_remaining,
        payoff_month: s.payoff_month,
        interest_remaining: s.interest_remaining,
      });
    }
  });

  it("no body: the loan as it is, with zero savings", async () => {
    const { bid, loan } = await ticketLoan();
    const d = await data(await simulate(bid, loan.id));
    const s = await summary(bid, loan.id, null);
    expect(d).toMatchObject({
      payments_remaining: s.payments_remaining,
      interest_savings: 0,
      months_saved: 0,
      monthly_payment: s.payment_used,
      extra_once: 0,
    });
    expect(d.schedule).toEqual(s.schedule);
  });

  it("a payment that never pays off has null payoff and savings", async () => {
    const { bid, loan } = await ticketLoan();
    const d = await data(await simulate(bid, loan.id, { monthly_payment: 500000 }));
    expect(d).toMatchObject({
      payments_remaining: null,
      payoff_month: null,
      interest_savings: null,
      months_saved: null,
    });
  });

  it("writes nothing", async () => {
    const { bid, loan } = await ticketLoan();
    const before = await summary(bid, loan.id, null);
    await simulate(bid, loan.id, { monthly_payment: 2000000, extra_once: 5000000 });
    expect(await summary(bid, loan.id, null)).toEqual(before);
  });
});

describe("payoff simulation: errors", () => {
  it("404 for a missing plan or account, 422 for a non-loan or a bad body", async () => {
    const w = await world();
    expect((await simulate(w.bid, "nope")).status).toBe(404);
    expect((await simulate("nope", w.mortgage.id)).status).toBe(404);
    const r = await simulate(w.bid, w.checking.id);
    expect(r.status).toBe(422);
    expect(((await r.json()) as Json).error.name).toBe("not_a_loan_account");
    expect((await simulate(w.bid, w.mortgage.id, { extra_once: -1 })).status).toBe(422);
    expect((await simulate(w.bid, w.mortgage.id, { monthly_payment: 1.5 })).status).toBe(422);
    expect((await simulate(w.bid, w.mortgage.id, { bogus: 1 })).status).toBe(422);
  });
  it("a loan without a payment and no monthly_payment is 422", async () => {
    const bid = await newPlan();
    const loan = await openAccount(bid, MORTGAGE);
    await env.DB.prepare("update accounts set minimum_payment = null where id = ?")
      .bind(loan.id)
      .run();
    expect((await simulate(bid, loan.id)).status).toBe(422);
    expect((await simulate(bid, loan.id, { monthly_payment: 1500000 })).status).toBe(200);
  });
});

describe("payoff simulation: surface", () => {
  it("the route and the tool exist, and MCP returns the REST data", async () => {
    const route = "/api/v1/budgets/{budget_id}/accounts/{account_id}/payoff-simulation";
    expect(await apiPaths()).toContain(route);
    expect(((await apiDocument()).paths[route] as Json).post).toBeDefined();
    expect(await listedToolNames()).toContain("simulate_loan_payoff");
    const { bid, loan } = await ticketLoan();
    const rest = await data(
      await simulate(bid, loan.id, { monthly_payment: 2000000, extra_once: 10000000 }),
    );
    const res = await tool("simulate_loan_payoff", {
      budget_id: bid,
      loan_account_id: loan.id,
      monthly_payment: 2000000,
      extra_once: 10000000,
    });
    expect(res.isError).toBeFalsy();
    expect(mcpData(res)).toEqual(rest);
    const w = await world();
    const bad = await tool("simulate_loan_payoff", {
      budget_id: w.bid,
      loan_account_id: w.checking.id,
    });
    expect(bad.isError).toBe(true);
  });
  it("GET is not allowed", async () => {
    const { bid, loan } = await ticketLoan();
    expect([404, 405]).toContain((await json(path(bid, loan.id))).status);
  });
});
