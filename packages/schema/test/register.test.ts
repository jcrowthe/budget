import { describe, expect, it } from "vitest";
import { categoryCell, sortTransactions } from "../src/register";
import type { TransactionDetail } from "../src/transactions";

let n = 0;
function tx(over: Partial<TransactionDetail>): TransactionDetail {
  n += 1;
  return {
    id: `id-${n}`,
    budget_id: "b",
    account_id: "a",
    date: "2026-11-10",
    payee_name: null,
    category_id: null,
    inflow_to_ready_to_assign: false,
    memo: null,
    amount: 0,
    cleared: "uncleared",
    approved: true,
    created_at: `2026-11-10T00:00:00.${String(n).padStart(3, "0")}Z`,
    category_name: null,
    category_group_name: null,
    updated_at: "x",
    ...over,
  };
}

const rows = () => [
  tx({ payee_name: "Starting Balance", amount: 500000, inflow_to_ready_to_assign: true }),
  tx({
    payee_name: "ZZ Alpha",
    amount: -25000,
    memo: "m1",
    category_id: "c",
    category_name: "Groceries",
    category_group_name: "Food",
  }),
  tx({ payee_name: "ZZ Beta", amount: 10000 }),
  tx({
    payee_name: "ZZ Gamma",
    amount: -5000,
    memo: "m3",
    category_id: "d",
    category_name: "Dining",
    category_group_name: "Food",
  }),
];
const order = (r: TransactionDetail[]) => r.map((t) => t.payee_name);

describe("sortTransactions", () => {
  it("default: same date by amount ascending, the same for date asc and desc", () => {
    const want = ["ZZ Alpha", "ZZ Gamma", "ZZ Beta", "Starting Balance"];
    expect(order(sortTransactions(rows(), "date", "desc"))).toEqual(want);
    expect(order(sortTransactions(rows(), "date", "asc"))).toEqual(want);
  });
  it("payee", () => {
    expect(order(sortTransactions(rows(), "payee", "desc"))).toEqual([
      "ZZ Gamma",
      "ZZ Beta",
      "ZZ Alpha",
      "Starting Balance",
    ]);
    expect(order(sortTransactions(rows(), "payee", "asc"))).toEqual([
      "Starting Balance",
      "ZZ Alpha",
      "ZZ Beta",
      "ZZ Gamma",
    ]);
  });
  it("category: blank sorts lowest", () => {
    // "" < "Food: Dining" < "Food: Groceries" < "Inflow: Ready to Assign"; the blank row is ZZ Beta.
    expect(order(sortTransactions(rows(), "category", "asc"))).toEqual([
      "ZZ Beta",
      "ZZ Gamma",
      "ZZ Alpha",
      "Starting Balance",
    ]);
    expect(order(sortTransactions(rows(), "category", "desc"))[3]).toBe("ZZ Beta");
  });
  it("memo: blanks last in desc, first in asc", () => {
    const d = order(sortTransactions(rows(), "memo", "desc"));
    expect(d.slice(0, 2)).toEqual(["ZZ Gamma", "ZZ Alpha"]);
    const a = order(sortTransactions(rows(), "memo", "asc"));
    expect(a.slice(2)).toEqual(["ZZ Alpha", "ZZ Gamma"]);
  });
  it("outflow and inflow", () => {
    expect(order(sortTransactions(rows(), "outflow", "desc")).slice(0, 2)).toEqual([
      "ZZ Alpha",
      "ZZ Gamma",
    ]);
    expect(order(sortTransactions(rows(), "outflow", "asc")).slice(2)).toEqual([
      "ZZ Gamma",
      "ZZ Alpha",
    ]);
    expect(order(sortTransactions(rows(), "inflow", "desc")).slice(0, 2)).toEqual([
      "Starting Balance",
      "ZZ Beta",
    ]);
    expect(order(sortTransactions(rows(), "inflow", "asc")).slice(2)).toEqual([
      "ZZ Beta",
      "Starting Balance",
    ]);
  });
  it("other dates: newest first for ties of another column", () => {
    const r = [
      tx({ payee_name: "A", date: "2026-01-01" }),
      tx({ payee_name: "A", date: "2026-02-01" }),
    ];
    expect(sortTransactions(r, "payee", "asc").map((t) => t.date)).toEqual([
      "2026-02-01",
      "2026-01-01",
    ]);
  });
  it("does not mutate its input", () => {
    const r = rows();
    const copy = [...r];
    sortTransactions(r, "payee", "asc");
    expect(r).toEqual(copy);
  });
});

describe("categoryCell", () => {
  const budget = { type: "checking", on_budget: true };
  it("text for a category and for the flag", () => {
    expect(
      categoryCell(
        tx({ category_id: "c", category_name: "Groceries", category_group_name: "Food" }),
        budget,
      ),
    ).toEqual({ kind: "text", text: "Food: Groceries" });
    expect(categoryCell(tx({ inflow_to_ready_to_assign: true }), budget)).toEqual({
      kind: "text",
      text: "Inflow: Ready to Assign",
    });
  });
  it("not needed on tracking and on a credit Starting Balance", () => {
    expect(categoryCell(tx({}), { type: "otherAsset", on_budget: false })).toEqual({
      kind: "notNeeded",
    });
    expect(
      categoryCell(tx({ payee_name: "Starting Balance" }), { type: "creditCard", on_budget: true }),
    ).toEqual({ kind: "notNeeded" });
  });
  it("needs a category otherwise", () => {
    expect(categoryCell(tx({ payee_name: "Shop" }), budget)).toEqual({ kind: "needsCategory" });
    expect(
      categoryCell(tx({ payee_name: "Shop" }), { type: "creditCard", on_budget: true }),
    ).toEqual({ kind: "needsCategory" });
  });
});
