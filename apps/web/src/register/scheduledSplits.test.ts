import { DEFAULT_FORMATTER } from "@budget/schema/plan-formats";
import type { ScheduledTransaction } from "@budget/schema/scheduled-transactions";
import { describe, expect, it } from "vitest";
import {
  draftFromScheduled,
  draftToScheduledCreate,
  draftToScheduledPatch,
  emptyDraft,
} from "./entryDraft";

// EXF-501 part 2: the editor carries the lines of a split schedule both ways.
const fmt = DEFAULT_FORMATTER;
const TODAY = "2026-11-15";
const line = (
  id: string,
  amount: number,
  category_id: string | null,
  memo: string | null = null,
) => ({
  id,
  amount,
  payee_id: null,
  payee_name: null,
  category_id,
  category_name: category_id ? `ZZ-TEST ${category_id}` : null,
  category_group_name: category_id ? "ZZ-TEST Group" : null,
  inflow_to_ready_to_assign: false,
  memo,
});
const split = (o: Partial<ScheduledTransaction> = {}): ScheduledTransaction => ({
  id: "s1",
  account_id: "a",
  account_name: "ZZ-TEST Checking",
  date_first: "2026-11-28",
  date_next: "2026-11-28",
  frequency: "monthly",
  amount: -40000,
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
  subtransactions: [line("l1", -30000, "g"), line("l2", -10000, "f", "fuel")],
  mirror: false,
  deleted: false,
  created_at: "x",
  updated_at: "x",
  ...o,
});

describe("draftFromScheduled with lines", () => {
  it("carries the lines, none for a plain schedule", () => {
    const d = draftFromScheduled(split(), fmt);
    expect(d.lines).toHaveLength(2);
    expect(d.lines?.[1]).toMatchObject({
      category: { kind: "category", id: "f" },
      memo: "fuel",
      outflowText: "10.00",
    });
    expect(draftFromScheduled(split({ subtransactions: [] }), fmt).lines).toBeNull();
  });
});

describe("draftToScheduledCreate with lines", () => {
  it("sends the lines and no category", () => {
    const d = { ...draftFromScheduled(split(), fmt), outflowText: "400.00" };
    const body = draftToScheduledCreate(d, "a", TODAY, fmt);
    expect(body.subtransactions).toEqual([
      { amount: -30000, category_id: "g", inflow_to_ready_to_assign: false },
      { amount: -10000, category_id: "f", inflow_to_ready_to_assign: false, memo: "fuel" },
    ]);
    expect(body).not.toHaveProperty("category_id");
    expect(body.amount).toBe(-400000);
  });
  it("sends none for a plain draft", () => {
    expect(draftToScheduledCreate(emptyDraft(TODAY, "a", fmt), "a", TODAY, fmt)).not.toHaveProperty(
      "subtransactions",
    );
  });
});

describe("draftToScheduledPatch with lines", () => {
  it("sends nothing when nothing changed", () => {
    const s = split();
    expect(draftToScheduledPatch(s, draftFromScheduled(s, fmt), TODAY, fmt)).toEqual({});
  });
  it("sends the lines with the amount when a line changes", () => {
    const s = split();
    const d = draftFromScheduled(s, fmt);
    const lines = d.lines?.map((l, i) => (i === 1 ? { ...l, outflowText: "150.00" } : l)) ?? null;
    const patch = draftToScheduledPatch(s, { ...d, lines, outflowText: "450.00" }, TODAY, fmt);
    expect(patch.subtransactions).toHaveLength(2);
    expect(patch.amount).toBe(-450000);
    expect(patch).not.toHaveProperty("category_id");
  });
  it("sends an empty list when the schedule leaves the split", () => {
    const s = split();
    const patch = draftToScheduledPatch(
      s,
      { ...draftFromScheduled(s, fmt), lines: null, category: { kind: "category", id: "g" } },
      TODAY,
      fmt,
    );
    expect(patch.subtransactions).toEqual([]);
    expect(patch.category_id).toBe("g");
  });
});
