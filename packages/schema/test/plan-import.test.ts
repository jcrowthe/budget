import { describe, expect, it } from "vitest";
import {
  buildImportPlan,
  IMPORT_ON_BUDGET,
  ImportError,
  type PlanImportOptions,
} from "../src/plan-import";

// EXF-477: the builder, on files written by hand from EXF-476's samples and from the ticket's rules.
const BOM = "﻿";
const PH =
  '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"';
const RH =
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"';

export const SAMPLE_PLAN = [
  PH,
  '"Oct 2026","Bills: Rent","Bills","Rent",$900.00,-$900.00,$0.00',
  '"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$300.00,-$120.50,$179.50',
  '"Oct 2026","Credit Card Payments: Sample Visa","Credit Card Payments","Sample Visa",$0.00,$40.00,$40.00',
  '"Oct 2026","Hidden Categories: Old Hobby","Hidden Categories","Old Hobby",$0.00,$0.00,$0.00',
  '"Nov 2026","Bills: Rent","Bills","Rent",$900.00,$0.00,$900.00',
].join("\r\n");
export const SAMPLE_REGISTER = [
  RH,
  '"Main Checking","","12/01/2026","Landlord","Bills: Rent","Bills","Rent","monthly",$900.00,$0.00,"Uncleared"',
  '"Main Checking","Red","11/14/2026","Corner Shop","Everyday: Groceries 🛒","Everyday","Groceries 🛒","Split (1/2) food",$30.00,$0.00,"Cleared"',
  '"Main Checking","Red","11/14/2026","Corner Shop","Fun: Games","Fun","Games","Split (2/2) ",$12.50,$0.00,"Cleared"',
  '"Main Checking","","11/10/2026","Transfer : Rainy Day Savings","","","","",$200.00,$0.00,"Reconciled"',
  '"Rainy Day Savings","","11/10/2026","Transfer : Main Checking","","","","",$0.00,$200.00,"Reconciled"',
  '"Main Checking","Tax","11/05/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","\\=bonus",$0.00,$2500.00,"Cleared"',
  '"Main Checking","","11/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$1000.00,"Cleared"',
].join("\r\n");

const build = (
  register = SAMPLE_REGISTER,
  plan = SAMPLE_PLAN,
  options: PlanImportOptions = {},
  extra: { zipName?: string | null } = {},
) =>
  buildImportPlan({
    plan: { name: "Sample Plan as of 2026-11-15 19-51 - Plan.csv", text: BOM + plan },
    register: { name: "Sample Plan as of 2026-11-15 19-51 - Register.csv", text: BOM + register },
    delimiter: ",",
    zipName:
      extra.zipName === undefined
        ? "YNAB Export - Sample Plan as of 2026-11-15 19-51.zip"
        : extra.zipName,
    options,
    serverToday: "2026-11-16",
  });
const regOf = (...lines: string[]) => [RH, ...lines].join("\r\n");
const warnCodes = (p: ReturnType<typeof build>) => p.warnings.map((w) => w.code);

describe("the sample (criterion 1)", () => {
  const p = build();
  it("names the plan and reads the export date from the zip name", () => {
    expect(p.name).toBe("Sample Plan");
    expect(p.exportDate).toBe("2026-11-15");
    expect(p.dateQuestion).toBeNull();
    expect(p.formats).toMatchObject({
      currency_symbol: "$",
      symbol_placement: "before",
      decimal_separator: ".",
      decimal_digits: 2,
      date_format: "MM/DD/YYYY",
      delimiter: "comma",
    });
  });
  it("makes the accounts with their proposed types", () => {
    expect(p.accounts.map((a) => [a.name, a.type, a.onBudget])).toEqual([
      ["Main Checking", "checking", true],
      ["Rainy Day Savings", "checking", true],
      ["Sample Visa", "creditCard", true],
    ]);
    expect(p.accounts[2]?.transactions).toBe(0);
    expect(warnCodes(p)).toContain("card_without_account");
  });
  it("makes the groups and categories, Old Hobby hidden, Games from the Register", () => {
    const names = [...p.groups].sort((a, b) => a.sort - b.sort).map((g) => g.name);
    expect(names).toEqual([
      "Credit Card Payments",
      "Bills",
      "Everyday",
      "Fun",
      "Hidden Categories",
    ]);
    expect(p.groups.find((g) => g.name === "Credit Card Payments")).toMatchObject({
      sort: -1,
      kind: "credit_card_payments",
    });
    const cat = (n: string) => p.categories.find((c) => c.name === n);
    expect(cat("Old Hobby")).toMatchObject({ hidden: true });
    expect(p.groups[cat("Old Hobby")?.group as number]?.name).toBe("Hidden Categories");
    expect(p.groups[cat("Games")?.group as number]?.name).toBe("Fun");
    expect(cat("Sample Visa")?.paymentAccount).toBe(2);
    expect(warnCodes(p)).toContain("category_not_in_plan_file");
    const sort = (n: string) => p.groups.find((g) => g.name === n)?.sort as number;
    expect(sort("Hidden Categories")).toBeGreaterThan(sort("Fun"));
  });
  it("assigns per month", () => {
    const a = p.assignments.map((x) => [p.categories[x.category]?.name, x.month, x.assigned]);
    expect(a).toEqual([
      ["Rent", "2026-10-01", 900000],
      ["Groceries 🛒", "2026-10-01", 300000],
      ["Rent", "2026-11-01", 900000],
    ]);
    expect(p.months).toEqual(["2026-10-01", "2026-11-01"]);
  });
  it("makes one split, one transfer pair, one schedule and drops the unknown flag", () => {
    expect(p.counts).toMatchObject({
      splits: 1,
      split_lines: 2,
      transfers_paired: 1,
      scheduled: 1,
    });
    const parent = p.transactions.find((t) => t.parent === null && t.payeeName === "Corner Shop");
    expect(parent).toMatchObject({
      amount: -42500,
      flag: "red",
      category: null,
      cleared: "cleared",
    });
    const lines = p.transactions.filter((t) => t.parent !== null);
    expect(
      lines.map((l) => [
        l.amount,
        l.memo,
        l.payee,
        l.splitIndex,
        p.categories[l.category as number]?.name,
      ]),
    ).toEqual([
      [-30000, "food", null, 0, "Groceries 🛒"],
      [-12500, null, null, 1, "Games"],
    ]);
    const xfers = p.transactions.filter((t) => t.transferAccount !== null);
    expect(
      xfers.map((t) => [
        p.accounts[t.account]?.name,
        t.amount,
        t.payeeName,
        t.payee,
        t.category,
        t.cleared,
      ]),
    ).toEqual([
      ["Main Checking", -200000, "Transfer : Rainy Day Savings", null, null, "reconciled"],
      ["Rainy Day Savings", 200000, "Transfer : Main Checking", null, null, "reconciled"],
    ]);
    expect(p.transactions[xfers[0] ? p.transactions.indexOf(xfers[0]) : 0]?.transfer).toBe(
      p.transactions.indexOf(xfers[1] as never),
    );
    expect(p.schedules).toHaveLength(1);
    expect(p.schedules[0]).toMatchObject({ date: "2026-12-01", amount: -900000, memo: "monthly" });
    const employer = p.transactions.find((t) => t.payeeName === "Employer");
    expect(employer).toMatchObject({
      flag: null,
      inflowToRta: true,
      memo: "=bonus",
      amount: 2500000,
    });
    expect(warnCodes(p)).toContain("flag_name_unknown");
    expect(p.transactions.find((t) => t.payeeName === "Starting Balance")).toMatchObject({
      inflowToRta: true,
      cleared: "cleared",
    });
    expect(p.payees.find((x) => x.name === "Starting Balance")?.system).toBe("starting_balance");
  });
});

describe("rules and edges", () => {
  it("bad plan rows name file, line and column", () => {
    expect(() =>
      build(SAMPLE_REGISTER, SAMPLE_PLAN.replace("$900.00,-$900.00", "$9x0.00,-$900.00")),
    ).toThrow(/Plan file line 2, column Assigned/);
    expect(() => build(regOf('"A","","11/14/2026","","","","","",$1.2.3,$0.00,"Cleared"'))).toThrow(
      /Register file line 2, column Outflow/,
    );
    expect(() =>
      build(SAMPLE_REGISTER, SAMPLE_PLAN.replace('"Oct 2026","Bills', '"Octo 2026","Bills')),
    ).toThrow(ImportError);
  });

  it("asks when every day is 12 or less, answers with the first candidate, and takes date_format", () => {
    const reg = regOf(
      '"A","","05/06/2026","P","","","","",$1.00,$0.00,"Cleared"',
      '"A","","04/03/2026","Q","","","","",$1.00,$0.00,"Cleared"',
    );
    const p = build(reg);
    expect(p.dateQuestion?.first_transaction).toBe("05/06/2026");
    expect(p.dateQuestion?.options).toEqual([
      { date_format: "MM/DD/YYYY", date: "2026-05-06" },
      { date_format: "DD/MM/YYYY", date: "2026-06-05" },
    ]);
    expect(p.dateQuestion?.question).toContain("The first transaction reads 05/06/2026");
    expect(build(reg, SAMPLE_PLAN, { date_format: "DD/MM/YYYY" }).transactions[0]?.date).toBe(
      "2026-06-05",
    );
    expect(() => build(reg, SAMPLE_PLAN, { date_format: "YYYY-MM-DD" })).toThrow(
      /is not a YYYY-MM-DD date/,
    );
  });

  it("asks nothing when every format reads the dates alike", () => {
    const p = build(regOf('"A","","10/10/2026","P","","","","",$1.00,$0.00,"Cleared"'));
    expect(p.dateQuestion).toBeNull();
    expect(p.transactions[0]?.date).toBe("2026-10-10");
  });

  it("refuses dates no format reads", () => {
    expect(() => build(regOf('"A","","31/31/2026","P","","","","",$1.00,$0.00,"Cleared"'))).toThrow(
      /No date format/,
    );
  });

  it("an incomplete split stays plain rows with a warning", () => {
    const p = build(
      regOf(
        '"A","","11/01/2026","P","","","","Split (1/3) a",$1.00,$0.00,"Cleared"',
        '"A","","11/01/2026","P","","","","Split (2/3) b",$1.00,$0.00,"Cleared"',
      ),
    );
    expect(p.counts.splits).toBe(0);
    expect(p.transactions.map((t) => t.memo)).toEqual(["Split (1/3) a", "Split (2/3) b"]);
    expect(warnCodes(p)).toContain("split_incomplete");
  });

  it("splits need the same account, date, flag and cleared", () => {
    const p = build(
      regOf(
        '"A","","11/01/2026","P","","","","Split (1/2) a",$1.00,$0.00,"Cleared"',
        '"A","","11/01/2026","P","","","","Split (2/2) b",$1.00,$0.00,"Uncleared"',
      ),
    );
    expect(p.counts.splits).toBe(0);
  });

  it("pairs equal transfer candidates one to one, first unpaired first", () => {
    const t = (a: string, o: string, amt: string) =>
      `"${a}","","11/01/2026","Transfer : ${o}","","","","m${amt}",${amt.startsWith("-") ? `${amt.slice(1)},$0.00` : `$0.00,${amt}`},"Cleared"`;
    const p = build(
      regOf(
        t("A", "B", "-$5.00"),
        t("A", "B", "-$5.00"),
        t("B", "A", "$5.00"),
        t("B", "A", "$5.00"),
      ),
    );
    expect(p.counts.transfers_paired).toBe(2);
    const tx = p.transactions;
    expect(tx[0]?.transfer).toBe(2);
    expect(tx[1]?.transfer).toBe(3);
    expect(tx[2]?.transfer).toBe(0);
  });

  it("a self-transfer and an unpaired transfer are plain rows with a warning", () => {
    const p = build(
      regOf(
        '"A","","11/01/2026","Transfer : A","","","","",$5.00,$0.00,"Cleared"',
        '"A","","11/02/2026","Transfer : B","","","","",$5.00,$0.00,"Cleared"',
        '"B","","11/02/2026","","","","","",$0.00,$1.00,"Cleared"',
      ),
    );
    expect(p.counts.transfers_paired).toBe(0);
    expect(p.transactions[0]).toMatchObject({ transferAccount: null, payeeName: "Transfer : A" });
    expect(warnCodes(p)).toContain("transfer_unpaired");
  });

  it("a transfer to a tracking account keeps the category of its on-plan side", () => {
    const reg = regOf(
      '"Main","","11/02/2026","Transfer : Home","Bills: Rent","Bills","Rent","",$5.00,$0.00,"Cleared"',
      '"Home","","11/02/2026","Transfer : Main","","","","",$0.00,$5.00,"Cleared"',
      '"Home","","11/01/2026","Starting Balance","","","","",$0.00,$100.00,"Cleared"',
    );
    const p = build(reg, SAMPLE_PLAN, {});
    expect(p.accounts.find((a) => a.name === "Home")).toMatchObject({
      type: "otherAsset",
      onBudget: false,
    });
    expect(p.transactions[0]?.category).not.toBeNull();
    expect(p.transactions[1]?.category).toBeNull();
  });

  it("proposes types from the Starting Balance and warns for a loan", () => {
    const p = build(
      regOf(
        '"Debt","","11/01/2026","Starting Balance","","","","",$500.00,$0.00,"Cleared"',
        '"House","","11/01/2026","Starting Balance","","","","",$0.00,$500.00,"Cleared"',
        '"Main","","11/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$5.00,"Cleared"',
      ),
      PH,
    );
    expect(p.accounts.map((a) => a.type)).toEqual(["otherLiability", "otherAsset", "checking"]);
    expect(warnCodes(p)).toContain("loan_as_tracking_liability");
    const o = build(
      regOf('"Debt","","11/01/2026","Starting Balance","","","","",$500.00,$0.00,"Cleared"'),
      PH,
      { account_types: { Debt: "otherAsset" } },
    );
    expect(o.accounts[0]).toMatchObject({ type: "otherAsset", proposedType: "otherLiability" });
    expect(warnCodes(o)).not.toContain("loan_as_tracking_liability");
  });

  it("account_types: unknown names and a card moved off credit types are refused", () => {
    expect(() =>
      build(SAMPLE_REGISTER, SAMPLE_PLAN, { account_types: { Nobody: "savings" } }),
    ).toThrow(/not an account/);
    expect(() =>
      build(SAMPLE_REGISTER, SAMPLE_PLAN, { account_types: { "Sample Visa": "checking" } }),
    ).toThrow(/credit/);
    expect(
      build(SAMPLE_REGISTER, SAMPLE_PLAN, { account_types: { "Main Checking": "savings" } })
        .accounts[0]?.type,
    ).toBe("savings");
  });

  it("a tracking account loses categories; a card's row in its own payment category loses it", () => {
    const plan = `${SAMPLE_PLAN}\r\n"Oct 2026","Credit Card Payments: Visa","Credit Card Payments","Visa",$0.00,$0.00,$0.00`;
    const p = build(
      regOf(
        '"Visa","","11/01/2026","Pay","Credit Card Payments: Visa","Credit Card Payments","Visa","",$5.00,$0.00,"Cleared"',
        '"Visa","","11/01/2026","Shop","Bills: Rent","Bills","Rent","",$5.00,$0.00,"Cleared"',
        '"Asset","","11/01/2026","Starting Balance","","","","",$0.00,$5.00,"Cleared"',
        '"Asset","","11/02/2026","X","Bills: Rent","Bills","Rent","",$1.00,$0.00,"Cleared"',
      ),
      plan,
    );
    expect(p.transactions[0]).toMatchObject({ category: null });
    expect(p.transactions[1]?.category).not.toBeNull();
    expect(p.transactions[3]).toMatchObject({ category: null });
    expect(warnCodes(p)).toEqual(
      expect.arrayContaining(["card_own_payment_category", "tracking_category_dropped"]),
    );
  });

  it("duplicate hidden names go to numbered hidden groups", () => {
    const plan = [
      PH,
      '"Oct 2026","Hidden Categories: X","Hidden Categories","X",$1.00,$0.00,$1.00',
      '"Oct 2026","Hidden Categories: X","Hidden Categories","X",$2.00,$0.00,$2.00',
      '"Nov 2026","Hidden Categories: X","Hidden Categories","X",$3.00,$0.00,$4.00',
      '"Nov 2026","Hidden Categories: X","Hidden Categories","X",$4.00,$0.00,$6.00',
    ].join("\r\n");
    const p = build(regOf(), plan);
    expect(p.groups.map((g) => g.name)).toEqual(["Hidden Categories", "Hidden Categories (2)"]);
    expect(p.categories.map((c) => [c.name, c.hidden, c.group])).toEqual([
      ["X", true, 0],
      ["X", true, 1],
    ]);
    expect(p.assignments.map((a) => [a.category, a.month, a.assigned])).toEqual([
      [0, "2026-10-01", 1000],
      [1, "2026-10-01", 2000],
      [0, "2026-11-01", 3000],
      [1, "2026-11-01", 4000],
    ]);
  });

  it("a hidden category named like a card whose Starting Balance is an uncategorized outflow is its payment category", () => {
    const plan = [
      PH,
      '"Oct 2026","Hidden Categories: Old Card","Hidden Categories","Old Card",$0.00,$0.00,$0.00',
    ].join("\r\n");
    const p = build(
      regOf('"Old Card","","11/01/2026","Starting Balance","","","","",$5.00,$0.00,"Cleared"'),
      plan,
    );
    expect(p.accounts[0]).toMatchObject({ type: "creditCard" });
    expect(p.categories[0]).toMatchObject({ name: "Old Card", hidden: false, paymentAccount: 0 });
    expect(warnCodes(p)).toContain("hidden_payment_category");
  });

  it("keeps the export's tie order of accounts and file order of equal rows", () => {
    const row = (a: string) => `"${a}","","11/01/2026","P","","","","",$5.00,$0.00,"Cleared"`;
    const p = build(regOf(row("C"), row("A"), row("B")), PH);
    expect(p.accounts.map((a) => [a.name, a.sort])).toEqual([
      ["C", 0],
      ["A", 1],
      ["B", 2],
    ]);
    const q = build(
      regOf(
        row("C"),
        row("A"),
        '"B","","11/01/2026","P","","","","",$9.00,$0.00,"Cleared"',
        row("B"),
      ),
      PH,
    );
    expect(q.accounts.map((a) => a.sort)).toEqual([0, 1, 2]);
    expect(q.transactions.map((t) => t.order)).toEqual([0, 1, 2, 3]);
  });

  it("a split or transfer after the export date stays a transaction with a warning", () => {
    const p = build(
      regOf(
        '"A","","12/20/2026","P","","","","Split (1/2) a",$1.00,$0.00,"Uncleared"',
        '"A","","12/20/2026","P","","","","Split (2/2) b",$1.00,$0.00,"Uncleared"',
        '"A","","12/20/2026","Transfer : B","","","","",$1.00,$0.00,"Uncleared"',
        '"B","","12/20/2026","Transfer : A","","","","",$0.00,$1.00,"Uncleared"',
        '"A","","12/21/2026","Plain","","","","",$1.00,$0.00,"Uncleared"',
      ),
    );
    expect(p.counts).toMatchObject({ splits: 1, transfers_paired: 1, scheduled: 1 });
    expect(warnCodes(p)).toContain("scheduled_not_supported");
  });

  it("name and export_date options win; without file names the defaults warn", () => {
    const p = build(SAMPLE_REGISTER, SAMPLE_PLAN, { name: "Mine", export_date: "2026-11-01" });
    expect(p.name).toBe("Mine");
    expect(p.exportDate).toBe("2026-11-01");
    expect(p.schedules.length).toBe(2);
    const q = buildImportPlan({
      plan: { name: "a.csv", text: SAMPLE_PLAN },
      register: { name: "b.csv", text: SAMPLE_REGISTER },
      delimiter: ",",
      zipName: null,
      options: {},
      serverToday: "2026-11-16",
    });
    expect(q.name).toBe("Imported Plan");
    expect(q.exportDate).toBe("2026-11-16");
    expect(q.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["export_date_missing", "name_missing"]),
    );
  });

  it("flags by colour name, any case; other names warn", () => {
    const p = build(
      regOf(
        '"A","blue","11/01/2026","P","","","","",$1.00,$0.00,"cleared"',
        '"A","Mine","11/01/2026","P","","","","",$1.00,$0.00,"nonsense"',
      ),
    );
    expect(p.transactions.map((t) => [t.flag, t.cleared])).toEqual([
      ["blue", "cleared"],
      [null, "uncleared"],
    ]);
    expect(warnCodes(p)).toEqual(expect.arrayContaining(["flag_name_unknown", "cleared_unknown"]));
  });

  it("reads a TSV in euros with comma decimals and DD.MM.YYYY dates", () => {
    const tab = (cells: string[]) => cells.join("\t");
    const plan = [
      tab(PH.split(",")),
      tab(['"Okt 2026"', '"G: C"', '"G"', '"C"', "10,00€", "0,00€", "10,00€"]),
    ]
      .join("\r\n")
      .replace("Okt", "Oct");
    const reg = [
      tab(RH.split(",")),
      tab([
        '"Konto"',
        '""',
        '"30.11.2026"',
        '"X"',
        '"G: C"',
        '"G"',
        '"C"',
        '""',
        "120,50€",
        "0,00€",
        '"Cleared"',
      ]),
    ].join("\r\n");
    const p = buildImportPlan({
      plan: { name: "p.tsv", text: plan },
      register: { name: "r.tsv", text: reg },
      delimiter: "\t",
      zipName: null,
      options: { export_date: "2026-12-01" },
      serverToday: "2026-11-16",
    });
    expect(p.transactions[0]).toMatchObject({ amount: -120500, date: "2026-11-30" });
    expect(p.formats).toMatchObject({
      currency_symbol: "€",
      symbol_placement: "after",
      decimal_separator: ",",
      decimal_digits: 2,
      date_format: "DD.MM.YYYY",
      delimiter: "tab",
    });
    expect(p.assignments[0]?.assigned).toBe(10000);
  });

  it("warns once about a different currency format later in the file", () => {
    const p = build(
      regOf(
        '"A","","11/01/2026","P","","","","",$1.00,$0.00,"Cleared"',
        '"A","","11/02/2026","P","","","","",€1.00,$0.00,"Cleared"',
      ),
    );
    expect(warnCodes(p)).toContain("currency_inconsistent");
  });

  it("the account types the app can create are all marked on or off the plan", () => {
    expect(Object.keys(IMPORT_ON_BUDGET).sort()).toEqual([
      "cash",
      "checking",
      "creditCard",
      "lineOfCredit",
      "otherAsset",
      "otherLiability",
      "savings",
    ]);
  });
});
