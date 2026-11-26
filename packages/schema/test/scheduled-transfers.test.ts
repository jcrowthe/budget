import { describe, expect, it } from "vitest";
import {
  ScheduledTransaction,
  ScheduledTransactionCreate,
  ScheduledTransactionUpdate,
} from "../src/scheduled-transactions";

const ok = { account_id: "a", date_first: "2026-12-01", amount: -100000 };
const row = {
  id: "s1",
  account_id: "a",
  account_name: "ZZ-TEST A",
  date_first: "2026-12-01",
  date_next: "2026-12-01",
  frequency: "monthly",
  amount: -100000,
  payee_id: null,
  payee_name: "Transfer : ZZ-TEST B",
  category_id: null,
  category_name: null,
  category_group_name: null,
  inflow_to_ready_to_assign: false,
  memo: null,
  flag_color: null,
  deleted: false,
  subtransactions: [],
  created_at: "2026-11-15T00:00:00.000Z",
  updated_at: "2026-11-15T00:00:00.000Z",
};

describe("scheduled transfer shapes", () => {
  it("create accepts transfer_account_id", () => {
    expect(ScheduledTransactionCreate.safeParse({ ...ok, transfer_account_id: "b" }).success).toBe(
      true,
    );
    expect(ScheduledTransactionCreate.safeParse({ ...ok, transfer_account_id: "" }).success).toBe(
      false,
    );
  });
  it("update accepts a transfer account, or null to go plain", () => {
    expect(ScheduledTransactionUpdate.safeParse({ transfer_account_id: null }).success).toBe(true);
    expect(ScheduledTransactionUpdate.safeParse({ transfer_account_id: "b" }).success).toBe(true);
  });
  it("a scheduled transaction carries the transfer fields", () => {
    const parsed = ScheduledTransaction.parse({
      ...row,
      transfer_account_id: "b",
      transfer_account_name: "ZZ-TEST B",
      mirror: false,
    });
    expect(parsed.transfer_account_id).toBe("b");
    expect(parsed.mirror).toBe(false);
    expect(ScheduledTransaction.safeParse({ ...row, transfer_account_id: null }).success).toBe(
      false,
    );
  });
});
