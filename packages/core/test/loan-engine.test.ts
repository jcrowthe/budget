import { describe, expect, it } from "vitest";
import {
  estimatedInterest,
  estimatedTotal,
  type LoanMonthIn,
  type LoanTerms,
  loanAt,
  rateThousandths,
  runLoan,
} from "../src/loan-engine";

const NOV = "2026-11-01";
const DEC = "2026-12-01";
const month = (m: string, p: Partial<LoanMonthIn> = {}): LoanMonthIn => ({
  month: m,
  payments: 0,
  starting: 0,
  other: 0,
  interest_rows: null,
  escrow_rows: null,
  ...p,
});
const mortgage: LoanTerms = { type: "mortgage", interest_rate: "6", escrow_amount: 300000 };
const auto: LoanTerms = { type: "autoLoan", interest_rate: "4.5", escrow_amount: null };

describe("rule 4: estimated interest", () => {
  it("is owed x rate / 12 to the cent", () => {
    expect(estimatedInterest(200000000, "6")).toBe(1000000);
    expect(estimatedInterest(15000000, "4.5")).toBe(56250);
  });
  it("rounds half away from zero to a multiple of 10 milliunits", () => {
    // 1000 x 6% / 12 = 5 -> a half cent -> 10
    expect(estimatedInterest(1000, "6")).toBe(10);
    expect(estimatedInterest(990, "6")).toBe(0); // 4.95 -> 0
    expect(estimatedInterest(1010, "6")).toBe(10); // 5.05 -> 10
  });
  it("is 0 without a rate or without a balance owed", () => {
    expect(estimatedInterest(200000000, null)).toBe(0);
    expect(estimatedInterest(0, "6")).toBe(0);
    expect(estimatedInterest(-5, "6")).toBe(0);
  });
  it("reads three-decimal rates", () => {
    expect(rateThousandths("6.125")).toBe(6125n);
    expect(rateThousandths("6")).toBe(6000n);
    expect(rateThousandths("4.5")).toBe(4500n);
    expect(rateThousandths(null)).toBe(0n);
    expect(estimatedInterest(120000000, "6.125")).toBe(612500);
  });
  it("keeps precision on a large balance", () => {
    expect(estimatedInterest(1e12, "6")).toBe(5000000000);
  });
});

describe("rules 5-7: a payment books escrow and interest, the rest is principal", () => {
  it("the mortgage example", () => {
    const [m] = runLoan(mortgage, [month(NOV, { payments: 1500000, starting: -200000000 })]);
    expect(m?.interest).toMatchObject({ amount: -1000000, state: "estimated", still_due: 0 });
    expect(m?.escrow).toMatchObject({ amount: -300000, state: "estimated" });
    expect(m?.principal).toBe(200000);
    expect(m?.closing).toBe(-199800000);
    expect(m?.estimated).toBe(-1300000);
  });
  it("the auto loan example: a short payment leaves interest still due and the balance unchanged", () => {
    const [m] = runLoan(auto, [month(NOV, { payments: 50000, starting: -15000000 })]);
    expect(m?.interest).toMatchObject({
      amount: -50000,
      still_due: 6250,
      estimated_total: -56250,
    });
    expect(m?.escrow).toBeNull();
    expect(m?.principal).toBe(0);
    expect(m?.closing).toBe(-15000000);
  });
  it("escrow is for a mortgage only", () => {
    const t: LoanTerms = { ...auto, escrow_amount: 300000 };
    const [m] = runLoan(t, [month(NOV, { payments: 400000, starting: -15000000 })]);
    expect(m?.escrow).toBeNull();
    expect(m?.interest?.amount).toBe(-56250);
  });
  it("a payment below the escrow caps the escrow and books no interest", () => {
    const [m] = runLoan(mortgage, [month(NOV, { payments: 100000, starting: -200000000 })]);
    expect(m?.escrow?.amount).toBe(-100000);
    expect(m?.interest?.amount).toBe(0);
    expect(m?.interest?.still_due).toBe(1000000);
    expect(m?.closing).toBe(-200000000);
  });
  it("no payment: no lines, closing = opening + rows", () => {
    const [m] = runLoan(mortgage, [month(NOV, { starting: -200000000, other: -5000 })]);
    expect(m?.interest).toBeNull();
    expect(m?.escrow).toBeNull();
    expect(m?.estimated).toBe(0);
    expect(m?.closing).toBe(-200005000);
  });
  it("other rows in the month do not change that month's estimate (A1)", () => {
    const [m] = runLoan(mortgage, [
      month(NOV, { payments: 1500000, starting: -200000000, other: -50000000 }),
    ]);
    expect(m?.interest?.amount).toBe(-1000000);
  });
  it("compounds: month 2 is owed month 1's closing", () => {
    const r = runLoan(mortgage, [
      month(DEC, { payments: 1500000 }),
      month(NOV, { payments: 1500000, starting: -200000000 }),
    ]);
    expect(r.map((x) => x.month)).toEqual([NOV, DEC]);
    expect(r[1]?.opening).toBe(-199800000);
    expect(r[1]?.interest?.amount).toBe(-999000);
    expect(r[1]?.closing).toBe(-199800000 + 1500000 - 999000 - 300000);
  });
  it("estimatedTotal sums the computed parts", () => {
    const r = runLoan(mortgage, [
      month(NOV, { payments: 1500000, starting: -200000000 }),
      month(DEC, { payments: 1500000 }),
    ]);
    expect(estimatedTotal(r)).toBe(-1300000 - 1299000);
  });
});

describe("rule 8: frozen lines", () => {
  it("a reconciled interest row replaces the estimate and survives no payment", () => {
    const [m] = runLoan(mortgage, [
      month(NOV, {
        starting: -200000000,
        interest_rows: { amount: -1000000, reconciled: true },
        escrow_rows: { amount: -300000, reconciled: true },
      }),
    ]);
    expect(m?.interest).toMatchObject({ amount: -1000000, state: "reconciled", still_due: 0 });
    expect(m?.escrow).toMatchObject({ amount: -300000, state: "reconciled" });
    expect(m?.estimated).toBe(0);
    expect(m?.closing).toBe(-200000000 - 1300000);
  });
  it("a non-reconciled frozen row is edited", () => {
    const [m] = runLoan(mortgage, [
      month(NOV, {
        payments: 1500000,
        starting: -200000000,
        interest_rows: { amount: -900000, reconciled: false },
      }),
    ]);
    expect(m?.interest?.state).toBe("edited");
    expect(m?.escrow?.state).toBe("estimated");
    expect(m?.estimated).toBe(-300000);
  });
});

describe("loanAt", () => {
  it("a month without rows carries the previous closing and has no lines", () => {
    const r = runLoan(mortgage, [month(NOV, { payments: 1500000, starting: -200000000 })]);
    const d = loanAt(r, DEC);
    expect(d).toMatchObject({ closing: -199800000, interest: null, escrow: null, payments: 0 });
    expect(loanAt(r, "2026-10-01").closing).toBe(0);
  });
});
