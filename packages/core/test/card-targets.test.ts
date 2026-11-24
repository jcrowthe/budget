import { describe, expect, it } from "vitest";
import { computeMonth, type EngineInput } from "../src/budget-engine";
import {
  CARD_TARGET_TYPES,
  cardTargetFields,
  cardTargetType,
  computeCardTargetMonth,
} from "../src/card-targets";
import { computeTargetMonth, type TargetDefinition, type TargetMonthContext } from "../src/targets";

// EXF-538: payment-category targets. The card's balances come from cardPayment(); the target arithmetic here
// takes them as input. Examples are the ticket's: 1,200.00 / 4 months = 300.00.

const NOV = "2026-11-01";
const DEC = "2026-12-01";

const payoff = (over: Partial<TargetDefinition> = {}): TargetDefinition => ({
  ...cardTargetFields("card_payoff_by_date", { month: "2027-02-01" }),
  created_on: "2026-11-16",
  ...over,
});
const monthly = (amount = 100000): TargetDefinition => ({
  ...cardTargetFields("card_monthly", { amount }),
  created_on: "2026-11-16",
});

const ctx = (o: Partial<TargetMonthContext> = {}): TargetMonthContext => ({
  month: NOV,
  today: "2026-11-16",
  leftover: 0,
  assigned: 0,
  activity: 0,
  available: 0,
  assignedIn: () => 0,
  ...o,
});

const card = (prior: number, current: number, available: number) => ({
  prior_balance: prior,
  current_balance: current,
  available,
});

describe("card target storage encoding", () => {
  it("round-trips the two types", () => {
    expect(CARD_TARGET_TYPES).toEqual(["card_payoff_by_date", "card_monthly"]);
    expect(cardTargetType(payoff())).toBe("card_payoff_by_date");
    expect(cardTargetType(monthly())).toBe("card_monthly");
    expect(payoff()).toMatchObject({ cadence: "custom", behavior: "balance", amount: 0 });
    expect(monthly()).toMatchObject({ cadence: "monthly", behavior: "set_aside", amount: 100000 });
  });
});

describe("Pay Off Balance by Date", () => {
  const def = payoff();
  it("the ticket's example: 1,200.00 over Nov..Feb is 300.00 a month", () => {
    const t = computeCardTargetMonth(
      def,
      ctx({ assigned: 100000, available: 12000 }),
      card(-1200000, -1112000, 12000),
    );
    expect(t).toMatchObject({
      status: "underfunded",
      needed_this_month: 300000,
      amount_this_month: 300000,
      funded: 100000,
      to_go_this_month: 200000,
      overall_to_go: 1100000,
      percent: 8,
      due_this_month: false,
      period_due_date: "2027-02-28",
    });
    expect(t?.definition).not.toHaveProperty("snoozed_months");
  });
  it("is on track once this month's share is assigned", () => {
    const t = computeCardTargetMonth(
      def,
      ctx({ assigned: 300000, available: 212000 }),
      card(-1200000, -1112000, 212000),
    );
    expect(t).toMatchObject({ status: "on_track", to_go_this_month: 0, overall_to_go: 900000 });
  });
  it("is funded when the payment category covers the balance, 100 % when paid off", () => {
    expect(
      computeCardTargetMonth(
        def,
        ctx({ assigned: 1200000, available: 1200000 }),
        card(-1200000, -1200000, 1200000),
      ),
    ).toMatchObject({ status: "funded", overall_to_go: 0, percent: 100 });
    expect(computeCardTargetMonth(def, ctx(), card(0, 0, 0))).toMatchObject({
      status: "funded",
      needed_this_month: 0,
      percent: 100,
    });
  });
  it("the month after the due month asks for the whole starting balance", () => {
    const t = computeCardTargetMonth(def, ctx({ month: "2027-03-01" }), card(-500000, -500000, 0));
    expect(t).toMatchObject({ needed_this_month: 500000, to_go_this_month: 500000 });
  });
  it("is null before the month it was created", () => {
    expect(computeCardTargetMonth(def, ctx({ month: "2026-10-01" }), card(0, 0, 0))).toBeNull();
  });
  it("snoozing changes the status only", () => {
    const base = computeCardTargetMonth(def, ctx(), card(-1200000, -1200000, 0));
    const s = computeCardTargetMonth(
      { ...def, snoozed_months: [NOV] },
      ctx(),
      card(-1200000, -1200000, 0),
    );
    expect(s?.status).toBe("snoozed");
    expect({ ...s, status: "x" }).toEqual({ ...base, status: "x" });
  });
});

describe("Pay Specific Amount Monthly", () => {
  const def = monthly();
  it("asks for the amount each month; assigning it funds the month", () => {
    expect(computeCardTargetMonth(def, ctx(), card(-1200000, -1200000, 0))).toMatchObject({
      status: "underfunded",
      needed_this_month: 100000,
      funded: 0,
      to_go_this_month: 100000,
      percent: 0,
    });
    expect(
      computeCardTargetMonth(
        def,
        ctx({ assigned: 100000, available: 100000 }),
        card(-1200000, -1200000, 100000),
      ),
    ).toMatchObject({ status: "funded", to_go_this_month: 0, percent: 100 });
  });
  it("asks again next month; the carried money is only Available", () => {
    expect(
      computeCardTargetMonth(
        def,
        ctx({ month: DEC, leftover: 100000, available: 100000 }),
        card(-1200000, -1200000, 100000),
      ),
    ).toMatchObject({ status: "underfunded", to_go_this_month: 100000 });
  });
  it("is the ordinary monthly set-aside computation", () => {
    const c = ctx({ assigned: 40000 });
    expect(computeCardTargetMonth(def, c, card(0, 0, 0))).toEqual(computeTargetMonth(def, c));
  });
});

describe("computeMonth wiring", () => {
  const base = (targets: EngineInput["targets"]): EngineInput => ({
    groups: [
      { id: "g", name: "Bills", sortOrder: 0, hidden: false, collapsed: false },
      {
        id: "pay",
        name: "Credit Card Payments",
        sortOrder: -1,
        hidden: false,
        collapsed: false,
        kind: "credit_card_payments",
      },
    ],
    categories: [
      {
        id: "bill",
        groupId: "g",
        name: "Bill",
        sortOrder: 0,
        hidden: false,
        kind: null,
        accountId: null,
      },
      {
        id: "p",
        groupId: "pay",
        name: "Card",
        sortOrder: 1,
        hidden: false,
        kind: "credit_card_payment",
        accountId: "k",
      },
    ],
    assignments: [
      { categoryId: "p", month: NOV, assigned: 100000 },
      { categoryId: "bill", month: NOV, assigned: 40000 },
    ],
    activity: [],
    notes: [],
    targets,
    today: "2026-11-16",
    cardFlows: [
      { accountId: "k", month: NOV, starting: -1200000, outflows: 0, inflows: 0, paid: 0 },
    ],
  });
  const cat = (d: ReturnType<typeof computeMonth>, id: string) =>
    d.groups.flatMap((g) => g.categories).find((c) => c.id === id);

  it("a payment category's payoff target uses the card's balances", () => {
    const d = computeMonth(base([{ categoryId: "p", ...payoff() }]), NOV);
    expect(cat(d, "p")?.target).toMatchObject({
      status: "underfunded",
      needed_this_month: 300000,
      funded: 100000,
      to_go_this_month: 200000,
      overall_to_go: 1100000,
      percent: 8,
    });
    expect(cat(d, "p")?.payment).toMatchObject({
      prior_balance: -1200000,
      current_balance: -1200000,
    });
  });
  it("an ordinary category's target is computed as before", () => {
    const def = { ...monthly(50000) };
    const d = computeMonth(base([{ categoryId: "bill", ...def }]), NOV);
    expect(cat(d, "bill")?.target).toEqual(
      computeTargetMonth(def, ctx({ assigned: 40000, available: 40000 })),
    );
  });
});
