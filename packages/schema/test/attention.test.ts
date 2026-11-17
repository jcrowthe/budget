import { describe, expect, it } from "vitest";
import { attentionBannerText, attentionTotal, canReject, needsAttention } from "../src/attention";
import { barActions, type SelRow } from "../src/register-selection";

const tx = (over = {}) => ({
  approved: true,
  category_id: null as string | null,
  inflow_to_ready_to_assign: false,
  subtransactions: [] as unknown[],
  transfer_account_id: null as string | null,
  payee_system: null as string | null,
  ...over,
});
const on = { on_budget: true };
const off = { on_budget: false };

describe("needsAttention", () => {
  it("is true for any unapproved row", () => {
    expect(needsAttention(tx({ approved: false, category_id: "c" }), off, null)).toBe(true);
  });
  it("is true for an approved uncategorized row on a plan account only", () => {
    expect(needsAttention(tx(), on, null)).toBe(true);
    expect(needsAttention(tx(), off, null)).toBe(false);
    expect(needsAttention(tx({ category_id: "c" }), on, null)).toBe(false);
  });
  it("skips Ready to Assign, splits, Starting Balance", () => {
    expect(needsAttention(tx({ inflow_to_ready_to_assign: true }), on, null)).toBe(false);
    expect(needsAttention(tx({ subtransactions: [{}] }), on, null)).toBe(false);
    expect(needsAttention(tx({ payee_system: "starting_balance" }), on, null)).toBe(false);
  });
  it("skips a transfer to a plan account, not one to an off-plan or unknown account", () => {
    const t = tx({ transfer_account_id: "x" });
    expect(needsAttention(t, on, on)).toBe(false);
    expect(needsAttention(t, on, off)).toBe(true);
    expect(needsAttention(t, on, null)).toBe(true);
  });
});

describe("canReject", () => {
  const base = { approved: false, import_id: "i", source: "plaid", transfer_account_id: null };
  it("agrees with the bar's rule", () => {
    for (const over of [
      {},
      { approved: true },
      { import_id: null },
      { source: null },
      { transfer_account_id: "t" },
    ]) {
      const r = { ...base, ...over };
      expect(canReject(r)).toBe(barActions([r as unknown as SelRow], () => null).reject);
    }
  });
});

describe("banner", () => {
  it("words singular and plural", () => {
    expect(attentionBannerText(1)).toBe("1 new transaction to approve or categorize.");
    expect(attentionBannerText(3)).toBe("3 new transactions to approve or categorize.");
  });
  it("sums counts, a missing one as 0", () => {
    expect(attentionTotal([{ needs_attention_count: 2 }, {}, { needs_attention_count: 1 }])).toBe(
      3,
    );
  });
});
