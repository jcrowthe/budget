import { DEFAULT_FORMATTER } from "@budget/schema/plan-formats";
import type { TransactionDetail } from "@budget/schema/transactions";
import { describe, expect, it } from "vitest";
import { draftForRepeat, makeRepeatingState, REPEAT_SPLIT_TRANSFER } from "./makeRepeating";

const fmt = DEFAULT_FORMATTER;

const tx = (o: Partial<TransactionDetail> = {}): TransactionDetail =>
  ({
    id: "t1",
    account_id: "a1",
    date: "2026-11-15",
    amount: -45000,
    payee_id: "p1",
    payee_name: "ZZ-TEST Phone Co",
    payee_system: null,
    category_id: "c1",
    inflow_to_ready_to_assign: false,
    memo: "ZZ-TEST monthly bill",
    cleared: "cleared",
    subtransactions: [],
    transfer_account_id: null,
    ...o,
  }) as unknown as TransactionDetail;

const open = () => false;

describe("makeRepeatingState", () => {
  it("is enabled for one plain transaction", () => {
    const t = tx();
    expect(makeRepeatingState({ real: [t], scheduledCount: 0, accountClosed: open })).toEqual({
      enabled: true,
      source: t,
    });
  });
  const reason = (s: ReturnType<typeof makeRepeatingState>) => (s.enabled ? null : s.reason);
  it("is off with a scheduled row selected", () => {
    expect(
      reason(makeRepeatingState({ real: [], scheduledCount: 1, accountClosed: open })),
    ).toMatch(/not on a scheduled one/);
  });
  it("is off with none or several rows", () => {
    for (const real of [[], [tx(), tx({ id: "t2" })]]) {
      expect(reason(makeRepeatingState({ real, scheduledCount: 0, accountClosed: open }))).toMatch(
        /Select one/,
      );
    }
  });
  it("is off for a split or a transfer", () => {
    const split = tx({ subtransactions: [{ id: "l" }] as never });
    const transfer = tx({ transfer_account_id: "a2" });
    for (const t of [split, transfer]) {
      expect(
        reason(makeRepeatingState({ real: [t], scheduledCount: 0, accountClosed: open })),
      ).toBe(REPEAT_SPLIT_TRANSFER);
    }
  });
  it("is off for a system payee", () => {
    const t = tx({ payee_system: "starting_balance" as never });
    expect(
      reason(makeRepeatingState({ real: [t], scheduledCount: 0, accountClosed: open })),
    ).toMatch(/loan interest can't repeat/);
  });
  it("is off in a closed account", () => {
    expect(
      reason(makeRepeatingState({ real: [tx()], scheduledCount: 0, accountClosed: () => true })),
    ).toMatch(/closed account/);
  });
});

describe("draftForRepeat", () => {
  it.each([
    ["2026-11-15", "2026-12-15"],
    ["2026-01-31", "2026-02-28"],
    ["2028-01-31", "2028-02-29"],
    ["2026-12-31", "2027-01-31"],
  ])("dates %s as %s", (from, to) => {
    expect(draftForRepeat(tx({ date: from }), fmt).lastDate).toBe(to);
    expect(fmt.parseDate(draftForRepeat(tx({ date: from }), fmt).dateText, from)).toBe(to);
  });
  it("copies the details and repeats monthly", () => {
    const d = draftForRepeat(tx(), fmt);
    expect(d).toMatchObject({
      accountId: "a1",
      payee: { id: "p1", name: "ZZ-TEST Phone Co" },
      category: { kind: "category", id: "c1" },
      memo: "ZZ-TEST monthly bill",
      outflowText: "45.00",
      inflowText: "",
      frequency: "monthly",
      cleared: "uncleared",
      lines: null,
      transferAccountId: null,
    });
  });
  it("carries the category kinds and an inflow", () => {
    expect(
      draftForRepeat(tx({ category_id: null, inflow_to_ready_to_assign: true, amount: 1000 }), fmt),
    ).toMatchObject({ category: { kind: "rta" }, inflowText: "1.00", outflowText: "" });
    expect(draftForRepeat(tx({ category_id: null }), fmt).category).toEqual({ kind: "none" });
  });
});
