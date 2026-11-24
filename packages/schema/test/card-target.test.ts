import { describe, expect, it } from "vitest";
import type { CardTargetCategory } from "../src/card-target";
import {
  cardDraftFromTarget,
  cardDraftToBody,
  cardTargetBreakdown,
  cardTargetHeading,
  cardTargetMessage,
  cardTargetPill,
  cardTargetStatusText,
  newCardDraft,
} from "../src/card-target";
import { DEFAULT_FORMATTER as fmt } from "../src/plan-formats";

const def = (o: object) => ({
  cadence: "monthly" as const,
  behavior: "set_aside" as const,
  amount: 0,
  day_of_week: null,
  day_of_month: null,
  due_date: null,
  due_month: null,
  repeat: null,
  created_on: "2026-11-16",
  ...o,
});
const target = (o: object, definition: object) => ({
  definition: def(definition),
  status: "underfunded" as const,
  needed_this_month: 0,
  amount_this_month: 0,
  funded: 0,
  to_go_this_month: 0,
  overall_to_go: 0,
  overfunded: 0,
  percent: 0,
  due_this_month: false,
  period_due_date: null,
  ...o,
});
const payment = (prior: number, current: number) =>
  ({ prior_balance: prior, current_balance: current }) as CardTargetCategory["payment"];

// The ticket's examples.
const payoff: CardTargetCategory = {
  assigned: 100000,
  available: 12000,
  payment: payment(-1200000, -1112000),
  target: target(
    {
      needed_this_month: 300000,
      funded: 100000,
      to_go_this_month: 200000,
      overall_to_go: 1100000,
      percent: 8,
    },
    { cadence: "custom", behavior: "balance", due_month: "2027-02-01" },
  ),
};
const monthly = (o: object, available = 0): CardTargetCategory => ({
  assigned: 0,
  available,
  payment: payment(-1200000, -1200000),
  target: target({ needed_this_month: 100000, to_go_this_month: 100000, ...o }, { amount: 100000 }),
});

describe("card target wording", () => {
  it("payoff example", () => {
    expect(cardTargetHeading(payoff, fmt)).toEqual({
      label: null,
      heading: "Pay off $1,200.00",
      subheading: "By Feb 2027",
    });
    expect(cardTargetMessage(payoff, fmt)?.text).toBe(
      "Assign $200.00 more this month to stay on track",
    );
    expect(cardTargetBreakdown(payoff).map((r) => [r.label, r.amount])).toEqual([
      ["Needed for Payoff", 1112000],
      ["Available for Payment", 12000],
      ["To Go", 1100000],
    ]);
    expect(cardTargetPill(payoff)).toEqual({ tone: "cautious", icon: "target" });
    expect(cardTargetStatusText(payoff, fmt)).toEqual({
      amount: "$200.00",
      text: " more needed this month",
    });
  });
  it("monthly example", () => {
    const m = monthly({});
    expect(cardTargetHeading(m, fmt)).toEqual({
      label: "Pay Specific Amount Monthly",
      heading: "$100.00",
      subheading: "Each Month",
    });
    expect(cardTargetMessage(m, fmt)?.text).toBe("Assign $100.00 to meet your target");
    expect(cardTargetBreakdown(m).map((r) => r.label)).toEqual([
      "Amount to Assign This Month",
      "Assigned So Far",
      "To Go",
    ]);
    const met = monthly(
      { status: "funded", funded: 100000, to_go_this_month: 0, percent: 100 },
      100000,
    );
    expect(cardTargetMessage(met, fmt)).toMatchObject({
      text: "You've met your target!",
      assign: null,
    });
    expect(cardTargetPill(met)).toEqual({ tone: "positive", icon: "check" });
  });
  it("no pill while snoozed or overpaid", () => {
    expect(cardTargetPill(monthly({ status: "snoozed" }))).toBeNull();
    expect(cardTargetPill(monthly({}, -1))).toBeNull();
  });
});

describe("card target form", () => {
  it("defaults to payoff next month, and wraps in December", () => {
    expect(newCardDraft("2026-11-16")).toMatchObject({
      type: "card_payoff_by_date",
      month: 11,
      year: 2026,
    });
    expect(newCardDraft("2026-12-31")).toMatchObject({ month: 0, year: 2027 });
  });
  it("builds the bodies and prefills from a target", () => {
    expect(cardDraftToBody({ ...newCardDraft("2026-11-16"), month: 1, year: 2027 })).toEqual({
      body: { type: "card_payoff_by_date", month: "2027-02-01" },
    });
    expect(
      cardDraftToBody({ ...newCardDraft("2026-11-16"), type: "card_monthly", amount: 100000 }),
    ).toEqual({
      body: { type: "card_monthly", amount: 100000 },
    });
    expect(cardDraftToBody({ ...newCardDraft("2026-11-16"), type: "card_monthly" })).toHaveProperty(
      "errors.amount",
    );
    expect(cardDraftFromTarget(payoff.target?.definition ?? def({}), "2026-11-16")).toMatchObject({
      type: "card_payoff_by_date",
      month: 1,
      year: 2027,
    });
  });
});
