import { describe, expect, it } from "vitest";
import {
  computeIncomeExpense,
  filterIncome,
  type IncomeRow,
  incomeExpenseCsv,
} from "../src/income-expense";
import type { SpendingRow } from "../src/spending-breakdown";

let n = 0;
interface Cat {
  id: string;
  name: string;
  order: number;
  hidden?: boolean;
}
const D8 = { id: "g1", name: "D8 Group", order: 1 };
// Plan order of the EXF-552 example: Hidden, Loan Pmt, Utilities, Fun, Food.
const HIDDEN: Cat = { id: "c-hid", name: "D8 Hidden", order: 1, hidden: true };
const LOAN: Cat = { id: "c-loan", name: "D8 Loan Pmt", order: 2 };
const UTIL: Cat = { id: "c-util", name: "D8 Utilities", order: 3 };
const FUN: Cat = { id: "c-fun", name: "D8 Fun", order: 4 };
const FOOD: Cat = { id: "c-food", name: "D8 Food", order: 5 };

function spend(date: string, cat: Cat | null, amount: number): SpendingRow {
  n += 1;
  const id = `s${n}`;
  return {
    id,
    transaction_id: id,
    subtransaction_id: null,
    account_id: "a-check",
    account_name: "D8 Checking",
    date,
    created_at: `2026-11-01T00:00:${String(n % 60).padStart(2, "0")}Z`,
    split_index: null,
    amount,
    payee_name: null,
    memo: null,
    cleared: "uncleared",
    category_id: cat?.id ?? null,
    category_name: cat?.name ?? null,
    category_hidden: cat?.hidden ?? false,
    category_order: cat?.order ?? 0,
    group_id: cat ? D8.id : null,
    group_name: cat ? D8.name : null,
    group_hidden: false,
    group_order: cat ? D8.order : 0,
  };
}

function inc(
  date: string,
  amount: number,
  payee: [string | null, string | null],
  o: Partial<IncomeRow> = {},
): IncomeRow {
  n += 1;
  const id = `i${n}`;
  return {
    id,
    transaction_id: id,
    subtransaction_id: null,
    account_id: "a-check",
    account_name: "D8 Checking",
    date,
    created_at: `2026-11-01T00:00:${String(n % 60).padStart(2, "0")}Z`,
    split_index: null,
    amount,
    payee_id: payee[0],
    payee_name: payee[1],
    memo: null,
    cleared: "cleared",
    ...o,
  };
}

const spending: SpendingRow[] = [
  spend("2026-07-10", FOOD, -120000),
  spend("2026-07-22", FUN, -45000),
  spend("2026-08-05", FOOD, -80500),
  spend("2026-08-20", FUN, -25000),
  spend("2026-09-03", UTIL, -60250),
  spend("2026-09-12", FOOD, -99990),
  spend("2026-09-20", null, -15000),
  spend("2026-10-01", LOAN, -250000),
  spend("2026-10-07", FUN, -30000),
  spend("2026-10-09", FOOD, -150000),
  spend("2026-10-21", FOOD, 20000),
  spend("2026-10-25", HIDDEN, -40000),
  spend("2026-11-03", FOOD, -55000),
];
const income = ["07", "08", "09", "10"].map((m) =>
  inc(`2026-${m}-15`, 3000000, ["p-emp", "D8 Employer"]),
);
const MAY_NOV = { start_month: "2026-05-01", end_month: "2026-11-01" };

describe("computeIncomeExpense: the EXF-552 worked table", () => {
  const d = computeIncomeExpense({ income, spending, span: MAY_NOV });
  const group = d.expense.groups[0];

  it("lists the months and the income", () => {
    expect(d.months).toHaveLength(7);
    expect(d.income.payees).toHaveLength(1);
    expect(d.income.payees[0]).toMatchObject({
      payee_id: "p-emp",
      name: "D8 Employer",
      months: [0, 0, 3000000, 3000000, 3000000, 3000000, 0],
      average: 1714290,
      total: 12000000,
    });
    expect(d.income.total.total).toBe(12000000);
  });

  it("Uncategorized and each category, in plan order", () => {
    expect(d.expense.uncategorized).toEqual({
      months: [0, 0, 0, 0, -15000, 0, 0],
      average: -2140,
      total: -15000,
    });
    expect(group?.categories.map((c) => [c.name, c.hidden, c.average, c.total])).toEqual([
      ["D8 Hidden", true, -5710, -40000],
      ["D8 Loan Pmt", false, -35710, -250000],
      ["D8 Utilities", false, -8610, -60250],
      ["D8 Fun", false, -14290, -100000],
      ["D8 Food", false, -69360, -485490],
    ]);
    expect(group?.categories[4]?.months).toEqual([0, 0, -120000, -80500, -99990, -130000, -55000]);
    expect(group?.categories[1]?.months).toEqual([0, 0, 0, 0, 0, -250000, 0]);
  });

  it("group, expense and net totals", () => {
    expect(group?.total).toEqual({
      months: [0, 0, -165000, -105500, -160240, -450000, -55000],
      average: -133680,
      total: -935740,
    });
    expect(d.expense.total).toEqual({
      months: [0, 0, -165000, -105500, -175240, -450000, -55000],
      average: -135820,
      total: -950740,
    });
    expect(d.net_income).toEqual({
      months: [0, 0, 2835000, 2894500, 2824760, 2550000, -55000],
      average: 1578470,
      total: 11049260,
    });
  });
});

describe("computeIncomeExpense: payees", () => {
  it("orders by name with (no payee) last, and nets a negative adjustment", () => {
    const d = computeIncomeExpense({
      income: [
        inc("2026-11-02", 30000, ["p1", "I Line Payer"]),
        inc("2026-11-02", 50000, ["p2", "I Parent"]),
        inc("2026-11-05", 10000, [null, null]),
        inc("2026-11-06", -250000, ["p3", "Manual Balance Adjustment"]),
      ],
      spending: [],
      span: { start_month: "2026-11-01", end_month: "2026-11-01" },
    });
    expect(d.income.payees.map((p) => [p.payee_id, p.name, p.total])).toEqual([
      ["p1", "I Line Payer", 30000],
      ["p2", "I Parent", 50000],
      ["p3", "Manual Balance Adjustment", -250000],
      [null, "(no payee)", 10000],
    ]);
    expect(d.income.total.total).toBe(-160000);
  });

  it("names the no-payee row (no payee) even when a row carries a payee_name", () => {
    const d = computeIncomeExpense({
      income: [
        inc("2026-11-05", 10000, [null, "Typed Name"]),
        inc("2026-11-06", 5000, [null, null]),
      ],
      spending: [],
      span: { start_month: "2026-11-01", end_month: "2026-11-01" },
    });
    expect(d.income.payees.map((p) => [p.payee_id, p.name, p.total])).toEqual([
      [null, "(no payee)", 15000],
    ]);
  });

  it("is empty with no rows", () => {
    const d = computeIncomeExpense({
      income: [],
      spending: [],
      span: { start_month: "2026-11-01", end_month: "2026-11-01" },
    });
    expect(d.income.payees).toEqual([]);
    expect(d.expense.uncategorized).toBeNull();
    expect(d.expense.groups).toEqual([]);
    expect([d.income.total.total, d.expense.total.total, d.net_income.total]).toEqual([0, 0, 0]);
  });

  it("filterIncome drops excluded accounts", () => {
    const rows = [
      inc("2026-11-02", 1000, ["p", "P"]),
      inc("2026-11-03", 2000, ["p", "P"], { account_id: "a2" }),
    ];
    expect(filterIncome(rows, ["a2"])).toHaveLength(1);
  });
});

describe("incomeExpenseCsv", () => {
  it("matches the export byte for byte, with no BOM and no final newline", () => {
    const csv = incomeExpenseCsv(computeIncomeExpense({ income, spending, span: MAY_NOV }));
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.endsWith("\n")).toBe(false);
    expect(csv).toBe(
      [
        '"Category","May 2026","Jun 2026","Jul 2026","Aug 2026","Sep 2026","Oct 2026","Nov 2026","Average","Total"',
        '"All Income Sources",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00',
        '"D8 Employer",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00',
        '"Total Income",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00',
        '"Uncategorized Transactions",0.00,0.00,0.00,0.00,-15.00,0.00,0.00,-2.14,-15.00',
        '"D8 Group",0.00,0.00,-165.00,-105.50,-160.24,-450.00,-55.00,-133.68,-935.74',
        '"D8 Hidden",0.00,0.00,0.00,0.00,0.00,-40.00,0.00,-5.71,-40.00',
        '"D8 Loan Pmt",0.00,0.00,0.00,0.00,0.00,-250.00,0.00,-35.71,-250.00',
        '"D8 Utilities",0.00,0.00,0.00,0.00,-60.25,0.00,0.00,-8.61,-60.25',
        '"D8 Fun",0.00,0.00,-45.00,-25.00,0.00,-30.00,0.00,-14.29,-100.00',
        '"D8 Food",0.00,0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-69.36,-485.49',
        '"Total Expenses",0.00,0.00,-165.00,-105.50,-175.24,-450.00,-55.00,-135.82,-950.74',
        '"Net Income",0.00,0.00,2835.00,2894.50,2824.76,2550.00,-55.00,1578.47,11049.26',
      ].join("\n"),
    );
  });
});
