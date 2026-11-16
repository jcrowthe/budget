import { describe, expect, it } from "vitest";
import { type CardFlow, cardPayment } from "../src/card-payment";

const NOV = "2026-11-01";
const flow = (month: string, o: Partial<CardFlow> = {}): CardFlow => ({
  accountId: "a",
  month,
  starting: 0,
  outflows: 0,
  inflows: 0,
  paid: 0,
  ...o,
});

describe("cardPayment states", () => {
  it("overpaid when Available is below 0, before anything else", () => {
    expect(cardPayment([flow(NOV, { inflows: 5000, paid: 5000 })], NOV, -1, 0).state).toBe(
      "overpaid",
    );
  });
  it("paid_off at a current balance of 0, even with Available 0", () => {
    const p = cardPayment([], NOV, 0, 0);
    expect(p.state).toBe("paid_off");
    expect(p.underfunded).toBe(0);
  });
  it("enough when Underfunded is exactly 0", () => {
    const p = cardPayment([flow(NOV, { outflows: -1000 })], NOV, 1000, 0);
    expect(p).toMatchObject({ state: "enough", underfunded: 0, current_balance: -1000 });
  });
  it("overspent_categories when underfunded with overspending on the card", () => {
    const p = cardPayment([flow(NOV, { outflows: -1000 })], NOV, 600, 400);
    expect(p).toMatchObject({ state: "overspent_categories", underfunded: 400 });
  });
  it("underfunded otherwise", () => {
    expect(cardPayment([flow(NOV, { outflows: -1000 })], NOV, 600, 0).state).toBe("underfunded");
  });
});

describe("cardPayment balances", () => {
  it("a Starting Balance dated in the month counts in Prior", () => {
    const p = cardPayment([flow(NOV, { starting: -7000, outflows: -1000 })], NOV, 0, 0);
    expect(p).toMatchObject({
      prior_balance: -7000,
      spending_and_outflows: -1000,
      current_balance: -8000,
    });
  });
  it("earlier months go into Prior, later months are ignored", () => {
    const p = cardPayment(
      [
        flow("2026-09-01", { starting: -5000, outflows: -1000, inflows: 500 }),
        flow(NOV, { inflows: 200, paid: 200 }),
        flow("2026-12-01", { outflows: -9000 }),
      ],
      NOV,
      0,
      0,
    );
    expect(p).toMatchObject({ prior_balance: -5500, payments_and_inflows: 200, paid: 200 });
  });
  it("never yields -0", () => {
    const p = cardPayment([], NOV, 0, 0);
    for (const v of Object.values(p)) expect(Object.is(v, -0)).toBe(false);
  });
  it("prior + spending + interest + payments = current, for 200 seeded flow sets", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 200; i++) {
      const months = ["2026-08-01", "2026-09-01", "2026-10-01", NOV, "2026-12-01"];
      const flows = months.map((m) =>
        flow(m, {
          starting: rnd(3) === 0 ? -(rnd(100) * 10) : 0,
          outflows: -(rnd(100) * 10),
          inflows: rnd(100) * 10,
          paid: 0,
        }),
      );
      const available = rnd(2000) - 500;
      const p = cardPayment(flows, NOV, available, rnd(3) * 10);
      expect(
        p.prior_balance + p.spending_and_outflows + p.interest_charges + p.payments_and_inflows,
      ).toBe(p.current_balance);
      expect(p.underfunded).toBe(Math.max(0, -p.current_balance - available));
    }
  });
});
