import { describe, expect, it } from "vitest";
import {
  ScheduledTransaction,
  ScheduledTransactionCreate,
  ScheduledTransactionUpdate,
} from "../src/scheduled-transactions";

const base = {
  account_id: "a1",
  date_first: "2026-11-28",
  frequency: "monthly" as const,
  amount: -40000,
};

describe("scheduled splits: the schema", () => {
  it("create takes lines in the contract shape", () => {
    const r = ScheduledTransactionCreate.safeParse({
      ...base,
      subtransactions: [
        { amount: -30000, category_id: "c1" },
        { amount: -10000, category_id: "c2", payee_id: "p1", memo: "ZZ-TEST" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("create takes the parity fields", () => {
    const r = ScheduledTransactionCreate.safeParse({
      ...base,
      subtransactions: [
        { amount: -30000, category_id: null, inflow_to_ready_to_assign: true },
        { amount: -10000, payee_name: "ZZ-TEST Market" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown line keys and more than 50 lines", () => {
    expect(
      ScheduledTransactionCreate.safeParse({
        ...base,
        subtransactions: [{ amount: 1, bogus: 1 }],
      }).success,
    ).toBe(false);
    expect(
      ScheduledTransactionCreate.safeParse({
        ...base,
        subtransactions: Array.from({ length: 51 }, () => ({ amount: 1, category_id: "c" })),
      }).success,
    ).toBe(false);
  });

  it("update takes lines, and an empty list", () => {
    expect(
      ScheduledTransactionUpdate.safeParse({
        amount: -5,
        subtransactions: [{ amount: -5, category_id: "c1" }],
      }).success,
    ).toBe(true);
    expect(ScheduledTransactionUpdate.safeParse({ subtransactions: [] }).success).toBe(true);
  });

  it("a response carries subtransactions", () => {
    const line = {
      id: "l1",
      amount: -1,
      payee_id: null,
      payee_name: null,
      category_id: "c1",
      category_name: "ZZ-TEST Groceries",
      category_group_name: "ZZ-TEST Group",
      inflow_to_ready_to_assign: false,
      memo: null,
    };
    const r = ScheduledTransaction.safeParse({
      id: "s1",
      ...base,
      account_name: "A",
      date_next: "2026-11-28",
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
      mirror: false,
      deleted: false,
      created_at: "x",
      updated_at: "x",
      subtransactions: [line],
    });
    expect(r.success).toBe(true);
    expect(r.data?.subtransactions).toHaveLength(1);
  });
});
