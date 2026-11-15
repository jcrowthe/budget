import { describe, expect, it } from "vitest";
import { MoneyMove } from "../src/months";
import { TransactionCreate } from "../src/transactions";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

describe("months schemas", () => {
  it("MoneyMove needs a side, distinct sides and a positive integer amount", () => {
    const base = { budget_id: id(), month: "2026-11-01", amount: 1000 };
    const a = id();
    expect(
      MoneyMove.safeParse({ ...base, from_category_id: a, to_category_id: id() }).success,
    ).toBe(true);
    expect(
      MoneyMove.safeParse({ ...base, from_category_id: a, to_category_id: null }).success,
    ).toBe(true);
    expect(
      MoneyMove.safeParse({ ...base, from_category_id: null, to_category_id: null }).success,
    ).toBe(false);
    expect(MoneyMove.safeParse({ ...base, from_category_id: a, to_category_id: a }).success).toBe(
      false,
    );
    expect(
      MoneyMove.safeParse({ ...base, amount: 0, from_category_id: a, to_category_id: null })
        .success,
    ).toBe(false);
    expect(
      MoneyMove.safeParse({ ...base, amount: 10.5, from_category_id: a, to_category_id: null })
        .success,
    ).toBe(false);
  });
  it("TransactionCreate refuses a category with the inflow flag and fractional amounts", () => {
    const base = { budget_id: id(), account_id: id(), date: "2026-11-02", amount: -5000 };
    const ok = TransactionCreate.parse(base);
    expect(ok).toMatchObject({
      inflow_to_ready_to_assign: false,
      cleared: "uncleared",
      approved: true,
    });
    expect(
      TransactionCreate.safeParse({ ...base, category_id: id(), inflow_to_ready_to_assign: true })
        .success,
    ).toBe(false);
    expect(TransactionCreate.safeParse({ ...base, amount: 1.5 }).success).toBe(false);
  });
});
