import { DEFAULT_FORMATTER } from "@budget/schema/plan-formats";
import type { ScheduledTransaction } from "@budget/schema/scheduled-transactions";
import { describe, expect, it } from "vitest";
import {
  draftFromScheduled,
  draftToScheduledCreate,
  draftToScheduledPatch,
  emptyDraft,
} from "./entryDraft";
import { scheduledRowKey, seriesIds } from "./scheduledKeys";

const fmt = DEFAULT_FORMATTER;
const TODAY = "2026-11-15";

const sched = (o: Partial<ScheduledTransaction> = {}): ScheduledTransaction => ({
  id: "s1",
  account_id: "a",
  account_name: "ZZ-TEST Checking",
  date_first: "2026-12-01",
  date_next: "2026-12-01",
  frequency: "monthly",
  amount: -100000,
  payee_id: null,
  payee_name: null,
  category_id: null,
  category_name: null,
  category_group_name: null,
  inflow_to_ready_to_assign: false,
  memo: null,
  flag_color: null,
  transfer_account_id: null,
  transfer_account_name: null,
  subtransactions: [],
  mirror: false,
  deleted: false,
  created_at: "2026-11-15T00:00:00.000Z",
  updated_at: "2026-11-15T00:00:00.000Z",
  ...o,
});
const transfer = (o: Partial<ScheduledTransaction> = {}) =>
  sched({
    transfer_account_id: "b",
    transfer_account_name: "ZZ-TEST Savings",
    payee_name: "Transfer : ZZ-TEST Savings",
    ...o,
  });
const mirror = () =>
  transfer({
    mirror: true,
    account_id: "b",
    account_name: "ZZ-TEST Savings",
    transfer_account_id: "a",
    transfer_account_name: "ZZ-TEST Checking",
    payee_name: "Transfer : ZZ-TEST Checking",
    amount: 100000,
  });

describe("scheduledRowKey and seriesIds", () => {
  it("a series keeps its id, a mirror is keyed apart", () => {
    expect(scheduledRowKey(transfer())).toBe("s1");
    expect(scheduledRowKey(mirror())).toBe("mirror:s1");
  });
  it("selecting both rows of one series gives one id, in row order", () => {
    const rows = [transfer(), mirror(), sched({ id: "s2" })];
    expect(seriesIds(new Set(["mirror:s1", "s1"]), rows)).toEqual(["s1"]);
    expect(seriesIds(new Set(["mirror:s1"]), rows)).toEqual(["s1"]);
    expect(seriesIds(new Set(["s2", "s1"]), rows)).toEqual(["s1", "s2"]);
    expect(seriesIds(new Set(), rows)).toEqual([]);
  });
});

describe("scheduled drafts with a transfer", () => {
  it("create sends transfer_account_id and no payee", () => {
    const d = {
      ...emptyDraft("2026-12-01", "a", fmt),
      transferAccountId: "b",
      payee: { id: null, name: "Transfer : ZZ-TEST Savings" },
      outflowText: "100.00",
      frequency: "monthly" as const,
    };
    const body = draftToScheduledCreate(d, "a", TODAY, fmt);
    expect(body).toMatchObject({ account_id: "a", transfer_account_id: "b", amount: -100000 });
    expect("payee_id" in body || "payee_name" in body).toBe(false);
    expect("category_id" in body).toBe(false);
  });
  it("a plain create sends no transfer field", () => {
    const body = draftToScheduledCreate(emptyDraft("2026-12-01", "a", fmt), "a", TODAY, fmt);
    expect("transfer_account_id" in body).toBe(false);
  });
  it("draftFromScheduled carries the transfer account and its payee text", () => {
    const d = draftFromScheduled(transfer(), fmt);
    expect(d.transferAccountId).toBe("b");
    expect(d.payee.name).toBe("Transfer : ZZ-TEST Savings");
    expect(draftFromScheduled(sched(), fmt).transferAccountId).toBeNull();
  });
  it("patch: an untouched transfer sends nothing", () => {
    const s = transfer();
    expect(draftToScheduledPatch(s, draftFromScheduled(s, fmt), TODAY, fmt)).toEqual({});
  });
  it("patch: a re-target sends the new account and no payee", () => {
    const s = transfer();
    const d = { ...draftFromScheduled(s, fmt), transferAccountId: "c" };
    const patch = draftToScheduledPatch(s, d, TODAY, fmt);
    expect(patch.transfer_account_id).toBe("c");
    expect("payee_id" in patch || "payee_name" in patch).toBe(false);
  });
  it("patch: plain to transfer sends the account, no payee", () => {
    const s = sched({ payee_id: "p1", payee_name: "ZZ Payee" });
    const d = {
      ...draftFromScheduled(s, fmt),
      transferAccountId: "b",
      payee: { id: null, name: "Transfer : ZZ-TEST Savings" },
    };
    const patch = draftToScheduledPatch(s, d, TODAY, fmt);
    expect(patch.transfer_account_id).toBe("b");
    expect("payee_id" in patch || "payee_name" in patch).toBe(false);
  });
  it("patch: transfer to plain sends null with the typed payee", () => {
    const s = transfer();
    const d = {
      ...draftFromScheduled(s, fmt),
      transferAccountId: null,
      payee: { id: null, name: "ZZ Landlord" },
    };
    expect(draftToScheduledPatch(s, d, TODAY, fmt)).toMatchObject({
      transfer_account_id: null,
      payee_name: "ZZ Landlord",
    });
  });
  it("patch: a series that had a category and becomes not-needed clears it", () => {
    const s = sched({ category_id: "c1" });
    const d = {
      ...draftFromScheduled(s, fmt),
      transferAccountId: "b",
      category: { kind: "none" as const },
    };
    expect(draftToScheduledPatch(s, d, TODAY, fmt)).toMatchObject({
      transfer_account_id: "b",
      category_id: null,
    });
  });
});
