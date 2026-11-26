import { describe, expect, it } from "vitest";
import type { MonthGroupDetail } from "../src/months";
import { categoryCell, categoryLabel, categoryMenu, sortTransactions } from "../src/register";
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
    import_id: null,
    source: null,
    imported_payee: null,
    import_payee_name: null,
    bank_description: null,
    matched: false,
    flag_color: null,
    status: null,
    pending_transaction_id: null,
    has_image: false,
    created_at: `2026-11-10T00:00:00.${String(n).padStart(3, "0")}Z`,
    category_name: null,
    category_group_name: null,
    payee_id: null,
    payee_system: null,
    updated_at: "x",
    match_details: null,
    transfer_account_id: null,
    transfer_transaction_id: null,
    transfer_account_name: null,
    subtransactions: [],
    ...over,
  };
}

const rows = () => [
  tx({
    payee_name: "Starting Balance",
    payee_system: "starting_balance",
    amount: 500000,
    inflow_to_ready_to_assign: true,
  }),
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
      categoryCell(tx({ payee_name: "Starting Balance", payee_system: "starting_balance" }), {
        type: "creditCard",
        on_budget: true,
      }),
    ).toEqual({ kind: "notNeeded" });
  });
  it("a split shows its own cell and text", () => {
    const line = {
      id: "l",
      amount: -1000,
      payee_id: null,
      payee_name: null,
      category_id: null,
      category_name: null,
      category_group_name: null,
      inflow_to_ready_to_assign: false,
      memo: null,
    };
    expect(categoryCell(tx({ subtransactions: [line, line] }), budget)).toEqual({ kind: "split" });
  });
  it("a transfer between on-plan accounts needs no category; with a tracking account it does", () => {
    const t = tx({ transfer_account_id: "x", payee_name: "Transfer : X" });
    expect(categoryCell(t, budget, { on_budget: true })).toEqual({ kind: "notNeeded" });
    expect(categoryCell(t, budget, { on_budget: false })).toEqual({ kind: "needsCategory" });
  });
  it("needs a category otherwise", () => {
    expect(categoryCell(tx({ payee_name: "Shop" }), budget)).toEqual({ kind: "needsCategory" });
    expect(
      categoryCell(tx({ payee_name: "Shop" }), { type: "creditCard", on_budget: true }),
    ).toEqual({ kind: "needsCategory" });
  });
});

describe("sorting by account", () => {
  const withAccount = (account_name: string, over: Partial<TransactionDetail> = {}) => ({
    ...tx(over),
    account_name,
  });
  it("orders by account name, ties by newest date then amount", () => {
    const a = withAccount("ZZ Beta", { date: "2026-11-01", amount: -5 });
    const b = withAccount("ZZ Alpha", { date: "2026-11-02", amount: -5 });
    const c = withAccount("ZZ Alpha", { date: "2026-11-09", amount: 7 });
    const d = withAccount("ZZ Alpha", { date: "2026-11-09", amount: -7 });
    expect(sortTransactions([a, b, c, d], "account", "asc")).toEqual([d, c, b, a]);
    expect(sortTransactions([a, b, c, d], "account", "desc")).toEqual([a, d, c, b]);
  });
});

describe("credit rows named Starting Balance", () => {
  it("need a category unless the payee is the system payee", () => {
    expect(
      categoryCell(tx({ payee_name: "Starting Balance", payee_system: null }), {
        type: "creditCard",
        on_budget: true,
      }),
    ).toEqual({ kind: "needsCategory" });
  });
});

const cat = (id: string, name: string, available: number, hidden = false) => ({
  id,
  name,
  sort: 0,
  hidden,
  kind: null,
  account_id: null,
  cash_spending: 0,
  credit_spending: 0,
  overspent: null,
  state: "ok" as const,
  assigned: 0,
  activity: 0,
  available,
  carried: 0,
  target: null,
  note: null,
  target_snoozed: false,
  upcoming: 0,
  upcoming_count: 0,
  available_after_upcoming: available,
  paired_account_id: null,
  paid_this_month: 0,
  payment: null,
});
const groups = [
  {
    id: "g1",
    name: "D4 Register",
    sort: 0,
    hidden: false,
    kind: null,
    collapsed: false,
    assigned: 0,
    activity: 0,
    available: 0,
    categories: [cat("c1", "D4 Groceries", 190000), cat("c2", "D4 Fuel", 5000, true)],
  },
  {
    id: "g2",
    name: "Other",
    sort: 1,
    hidden: true,
    kind: null,
    collapsed: false,
    assigned: 0,
    activity: 0,
    available: 0,
    categories: [cat("c3", "Misc", 0)],
  },
  {
    id: "g3",
    name: "Empty",
    sort: 2,
    hidden: false,
    kind: null,
    collapsed: false,
    assigned: 0,
    activity: 0,
    available: 0,
    categories: [],
  },
] satisfies MonthGroupDetail[];

describe("categoryMenu", () => {
  it("lists Inflow first, then every group with categories, hidden included", () => {
    const m = categoryMenu(groups, 42000, "");
    expect(m.groups.map((g) => g.name)).toEqual(["Inflow", "D4 Register", "Other"]);
    expect(m.flat.map((r) => r.name)).toEqual([
      "Ready to Assign",
      "D4 Groceries",
      "D4 Fuel",
      "Misc",
    ]);
    expect(m.flat[0]?.amount).toBe(42000);
  });
  it("matches category names, case-insensitively", () => {
    expect(categoryMenu(groups, 0, "d4 gro").flat.map((r) => r.name)).toEqual(["D4 Groceries"]);
  });
  it("a matching group lists all its categories", () => {
    expect(categoryMenu(groups, 0, "d4 reg").flat.map((r) => r.name)).toEqual([
      "D4 Groceries",
      "D4 Fuel",
    ]);
    expect(categoryMenu(groups, 0, "inflow").flat.map((r) => r.name)).toEqual(["Ready to Assign"]);
  });
  it("is empty with no match", () => {
    expect(categoryMenu(groups, 0, "zzzz").empty).toBe(true);
  });
});

describe("categoryLabel", () => {
  it("shows Group: Category", () => {
    expect(categoryLabel({ kind: "category", id: "c1" }, groups)).toBe("D4 Register: D4 Groceries");
    expect(categoryLabel({ kind: "rta" }, groups)).toBe("Inflow: Ready to Assign");
    expect(categoryLabel({ kind: "none" }, groups)).toBe("");
    expect(categoryLabel({ kind: "category", id: "zz" }, groups)).toBe("");
  });
});
