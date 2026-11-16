import { describe, expect, it } from "vitest";
import {
  paymentCategoryOf,
  paymentDisplay,
  paymentPrefill,
  paymentTone,
  transferEntryLabel,
} from "../src/card-payments";

const acct = (name: string, type: string, on_budget = true) => ({ name, type, on_budget });
const chk = acct("Checking", "checking");
const visa = acct("Visa", "creditCard");
const loc = acct("Line", "lineOfCredit");
const asset = acct("Asset", "otherAsset", false);

describe("paymentDisplay", () => {
  it("reads the same on both sides of a cash to card transfer", () => {
    expect(paymentDisplay(visa, chk)).toEqual({
      payee: "Payment: Checking",
      category: "Credit Card Payments: Visa",
      cardIsSide: true,
    });
    expect(paymentDisplay(chk, visa)).toEqual({
      payee: "Payment: Visa",
      category: "Credit Card Payments: Visa",
      cardIsSide: false,
    });
  });
  it("is null for card to card, card to tracking, cash to cash and no other side", () => {
    expect(paymentDisplay(visa, loc)).toBeNull();
    expect(paymentDisplay(visa, asset)).toBeNull();
    expect(paymentDisplay(asset, visa)).toBeNull();
    expect(paymentDisplay(chk, acct("Savings", "savings"))).toBeNull();
    expect(paymentDisplay(visa, null)).toBeNull();
  });
});

describe("transferEntryLabel", () => {
  it("says Payment from on a card's register for an on-plan cash account only", () => {
    expect(transferEntryLabel(visa, chk)).toBe("Payment from Checking");
    expect(transferEntryLabel(visa, asset)).toBe("To/From Asset");
    expect(transferEntryLabel(visa, loc)).toBe("To/From Line");
    expect(transferEntryLabel(chk, visa)).toBe("To/From Visa");
    expect(transferEntryLabel(null, chk)).toBe("To/From Checking");
  });
});

describe("paymentTone and paymentPrefill", () => {
  it("colours by sign", () => {
    expect(paymentTone(-1)).toBe("negative");
    expect(paymentTone(0)).toBe("zero");
    expect(paymentTone(1)).toBe("positive");
  });
  it("prefills only a positive Available", () => {
    expect(paymentPrefill(335000)).toBe("335.00");
    expect(paymentPrefill(0)).toBe("");
    expect(paymentPrefill(-1)).toBe("");
    expect(paymentPrefill(undefined)).toBe("");
    expect(paymentPrefill(null)).toBe("");
  });
});

describe("paymentCategoryOf", () => {
  const cat = (
    id: string,
    kind: "credit_card_payment" | null,
    account_id: string | null,
    available: number,
  ) => ({ id, name: `N-${id}`, kind, account_id, available }) as never;
  const month = {
    groups: [
      { categories: [cat("g", null, null, 5)] },
      {
        categories: [
          cat("p1", "credit_card_payment", "a1", 100),
          cat("p2", "credit_card_payment", "a2", -7),
        ],
      },
    ],
  } as never;
  it("finds the card's payment category", () => {
    expect(paymentCategoryOf(month, "a2")).toEqual({ id: "p2", name: "N-p2", available: -7 });
    expect(paymentCategoryOf(month, "zz")).toBeNull();
  });
});
