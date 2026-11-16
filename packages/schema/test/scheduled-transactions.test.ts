import { describe, expect, it } from "vitest";
import {
  ScheduledBulkRequest,
  ScheduledTransactionCreate,
  ScheduledTransactionUpdate,
} from "../src/scheduled-transactions";

const ok = { account_id: "a", date_first: "2026-12-01", amount: -800000 };

describe("scheduled transaction shapes", () => {
  it("defaults the frequency to never", () => {
    expect(ScheduledTransactionCreate.parse(ok).frequency).toBe("never");
  });
  it("refuses fields it does not support", () => {
    for (const extra of [
      { date_next: "2026-12-02" },
      { transfer_account_id: "x" },
      { subtransactions: [] },
    ]) {
      expect(ScheduledTransactionCreate.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
  });
  it("refuses an unknown frequency and an impossible date", () => {
    expect(ScheduledTransactionCreate.safeParse({ ...ok, frequency: "fortnightly" }).success).toBe(
      false,
    );
    expect(ScheduledTransactionCreate.safeParse({ ...ok, date_first: "2026-02-30" }).success).toBe(
      false,
    );
  });
  it("accepts a far-future date", () => {
    expect(ScheduledTransactionCreate.safeParse({ ...ok, date_first: "2032-12-31" }).success).toBe(
      true,
    );
  });
  it("an update needs a field", () => {
    expect(ScheduledTransactionUpdate.safeParse({}).success).toBe(false);
    expect(ScheduledTransactionUpdate.safeParse({ memo: "x" }).success).toBe(true);
  });
  it("bulk holds 1 to 100 ids", () => {
    expect(ScheduledBulkRequest.safeParse({ op: "delete", ids: [] }).success).toBe(false);
    expect(ScheduledBulkRequest.safeParse({ op: "enter_now", ids: ["a"] }).success).toBe(true);
    expect(
      ScheduledBulkRequest.safeParse({
        op: "enter_now",
        ids: Array.from({ length: 101 }, (_, i) => `${i}`),
      }).success,
    ).toBe(false);
  });
});
