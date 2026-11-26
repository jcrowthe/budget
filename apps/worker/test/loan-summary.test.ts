import { LoanSummaryResponse } from "@budget/schema/loan-summary";
import { describe, expect, it } from "vitest";
import type { Json } from "./bulk-helpers";
import { pinClock } from "./clock";
import { json } from "./helpers";
import {
  findCategory,
  NOV,
  newPlan,
  openAccount,
  pay,
  send,
  summary,
  tool,
  world,
} from "./loan-world";
import { apiPaths, listedToolNames } from "./surface";

pinClock("2026-11-15T12:00:00Z"); // fixed-month fixtures (EXF-977)

// EXF-541: GET .../accounts/{id}/summary and get_loan_summary. Milliunits.
describe("loan summary", () => {
  it("the mortgage: 360 payments to Nov 2056, then 359 after a payment", async () => {
    const w = await world();
    const s = await summary(w.bid, w.mortgage.id);
    LoanSummaryResponse.parse({ data: s });
    expect(s).toMatchObject({
      payoff_month: "2056-11-01",
      payments_remaining: 360,
      remaining_balance: 200000000,
      original_balance: 200000000,
      percent_remaining: 100,
      escrow_amount: 300000,
      interest_rate: "6",
      minimum_payment: 1500000,
      payment_used: 1500000,
      payment_source: "minimum",
    });
    expect(s.schedule[0]).toEqual({ month: NOV, balance: 200000000 });
    expect(s.schedule.at(-1)).toEqual({ month: "2056-11-01", balance: 0 });
    expect(s.original_schedule[0]).toEqual({ month: NOV, balance: 200000000 });
    expect(s.history).toEqual([{ month: NOV, balance: 200000000 }]);
    expect(s.balance_updated_at).toBeNull();
    const r = await pay(w.bid, w.mortgage.id, {
      from_account_id: w.checking.id,
      amount: 1500000,
      date: "2026-11-16",
    });
    expect(r.status).toBe(201);
    const after = await summary(w.bid, w.mortgage.id);
    expect(after).toMatchObject({
      remaining_balance: 199800000,
      payments_remaining: 359,
      payoff_month: "2056-10-01",
      percent_remaining: 99.9,
    });
    expect(after.history).toEqual([{ month: NOV, balance: 199800000 }]);
  });
  it("auto and medical loans have no escrow", async () => {
    const w = await world();
    const a = await summary(w.bid, w.auto.id);
    expect(a).toMatchObject({
      escrow_amount: null,
      payments_remaining: 47,
      payoff_month: "2030-10-01",
    });
    const m = await summary(w.bid, w.medical.id);
    expect(m).toMatchObject({ payments_remaining: 10, payoff_month: "2027-09-01" });
  });
  it("paired: the category, Available and the minimum; a target changes the payment", async () => {
    const w = await world();
    const cat = await findCategory(w.bid, "Mortgage Pay");
    const s = await summary(w.bid, w.mortgage.id);
    expect(s.paired_category).toEqual({
      id: cat.id,
      name: "Mortgage Pay",
      group_name: "ZZ Loans",
      available: 0,
      target: null,
    });
    const put = await send(`/api/v1/budgets/${w.bid}/categories/${cat.id}/target`, "PUT", {
      cadence: "monthly",
      behavior: "set_aside",
      amount: 1600000,
    });
    expect(put.status).toBe(200);
    const t = await summary(w.bid, w.mortgage.id);
    expect(t).toMatchObject({ payment_source: "target", payment_used: 1600000 });
    expect(t.paired_category.target).toMatchObject({
      type: "debt_payment",
      amount: 1600000,
      cadence: "monthly",
    });
    expect(t.payments_remaining).toBeLessThan(360);
    expect(t.payoff_month < "2056-11-01").toBe(true);
  });
  it("a monthly refill target is not the debt kind and falls back to the minimum", async () => {
    const w = await world();
    const cat = await findCategory(w.bid, "Mortgage Pay");
    await send(`/api/v1/budgets/${w.bid}/categories/${cat.id}/target`, "PUT", {
      cadence: "monthly",
      behavior: "refill",
      amount: 1600000,
    });
    const s = await summary(w.bid, w.mortgage.id);
    expect(s.paired_category.target.type).toBeNull();
    expect(s).toMatchObject({ payment_source: "minimum", payment_used: 1500000 });
  });
  it("a weekly target falls back to the minimum", async () => {
    const w = await world();
    const cat = await findCategory(w.bid, "Mortgage Pay");
    await send(`/api/v1/budgets/${w.bid}/categories/${cat.id}/target`, "PUT", {
      cadence: "weekly",
      behavior: "set_aside",
      amount: 100000,
      day_of_week: 1,
    });
    const s = await summary(w.bid, w.mortgage.id);
    expect(s).toMatchObject({ payment_source: "minimum", payment_used: 1500000 });
  });
  it("unpaired has no paired category", async () => {
    const w = await world(false);
    expect((await summary(w.bid, w.mortgage.id)).paired_category).toBeNull();
  });
  it("never pays off: nulls and a one-point schedule", async () => {
    const bid = await newPlan();
    const loan = await openAccount(bid, {
      name: "Slow",
      type: "personalLoan",
      balance: 200000000,
      interest_rate: "6",
      minimum_payment: 500000,
    });
    const s = await summary(bid, loan.id);
    expect(s).toMatchObject({
      payoff_month: null,
      payments_remaining: null,
      interest_remaining: 0,
    });
    expect(s.schedule).toEqual([{ month: NOV, balance: 200000000 }]);
  });
  it("refusals", async () => {
    const w = await world();
    const r1 = await json(`/api/v1/budgets/${w.bid}/accounts/${w.checking.id}/summary`);
    expect(r1.status).toBe(422);
    expect(((await r1.json()) as Json).error.name).toBe("not_a_loan_account");
    expect((await json(`/api/v1/budgets/${w.bid}/accounts/nope/summary`)).status).toBe(404);
    expect((await json(`/api/v1/budgets/nope/accounts/${w.mortgage.id}/summary`)).status).toBe(404);
    expect(
      (await json(`/api/v1/budgets/${w.bid}/accounts/${w.mortgage.id}/summary?month=2026-11-15`))
        .status,
    ).toBe(422);
  });
  it("is on the surface, and MCP returns the REST data", async () => {
    expect(await apiPaths()).toContain("/api/v1/budgets/{budget_id}/accounts/{account_id}/summary");
    const names = await listedToolNames();
    expect(names).toContain("get_loan_summary");
    expect(names).toContain("pair_loan_category");
    const w = await world();
    const rest = await summary(w.bid, w.mortgage.id);
    const res = await tool("get_loan_summary", {
      budget_id: w.bid,
      loan_account_id: w.mortgage.id,
      month: NOV,
    });
    expect(res.isError).toBeFalsy();
    const body = res.structuredContent ?? JSON.parse(res.content[0].text);
    expect(body).toEqual(rest);
    const bad = await tool("get_loan_summary", {
      budget_id: w.bid,
      loan_account_id: w.checking.id,
    });
    expect(bad.isError).toBe(true);
  });
});
