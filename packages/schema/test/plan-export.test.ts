import { describe, expect, it } from "vitest";
import { PAYEE_SYSTEMS } from "../src/payees";
import {
  categoryCell,
  DEFAULT_PLAN_FORMAT,
  ExportNow,
  exportFormat,
  exportMonthCeiling,
  exportNames,
  monthLabel,
  nowRangeText,
  nowWithinServerDays,
  planFile,
  type RegisterEntry,
  registerFile,
  SYSTEM_PAYEE_NAMES,
  safeName,
  textField,
} from "../src/plan-export";

const US = exportFormat(DEFAULT_PLAN_FORMAT);
const EU = exportFormat({
  currency_symbol: "€",
  symbol_placement: "after",
  decimal_separator: ",",
  group_separator: ".",
  decimal_digits: 2,
  date_format: "DD.MM.YYYY",
});

describe("amounts (ticket: $0.00, $17.34, $200000.00, -$120.00)", () => {
  it("writes the default format without group separators", () => {
    expect(US.amount(17340)).toBe("$17.34");
    expect(US.amount(-120000)).toBe("-$120.00");
    expect(US.amount(200000000)).toBe("$200000.00");
    expect(US.amount(0)).toBe("$0.00");
    expect(US.amount(1234560)).toBe("$1234.56"); // the export writes no thousands separator
    expect(US.amount(17345)).toBe("$17.35");
    expect(US.amount(-4)).toBe("$0.00");
  });
  it("places the symbol after, or not at all", () => {
    const after = exportFormat({
      ...DEFAULT_PLAN_FORMAT,
      symbol_placement: "after",
      currency_symbol: "€",
    });
    expect(after.amount(45000)).toBe("45.00€");
    expect(after.amount(-45000)).toBe("-45.00€");
    expect(exportFormat({ ...DEFAULT_PLAN_FORMAT, symbol_placement: "none" }).amount(45000)).toBe(
      "45.00",
    );
  });
  it("honours the digits", () => {
    expect(exportFormat({ ...DEFAULT_PLAN_FORMAT, decimal_digits: 0 }).amount(17340)).toBe("$17");
    expect(exportFormat({ ...DEFAULT_PLAN_FORMAT, decimal_digits: 3 }).amount(17340)).toBe(
      "$17.340",
    );
    expect(() => exportFormat({ ...DEFAULT_PLAN_FORMAT, decimal_digits: 4 })).toThrow(RangeError);
  });
});

describe("the 123.456,78 plan", () => {
  it("uses TAB and tsv", () => {
    expect(EU.delimiter).toBe("\t");
    expect(EU.extension).toBe("tsv");
    expect(EU.amount(120500)).toBe("120,50€");
    expect(EU.amount(-45000)).toBe("-45,00€");
    expect(EU.date("2026-11-30")).toBe("30.11.2026");
    expect(US.delimiter).toBe(",");
    expect(US.extension).toBe("csv");
    expect(US.date("2026-11-15")).toBe("11/15/2026");
  });
  it("names the files with the extension", () => {
    const n = exportNames("Test Budget", "2026-11-15T19:51", EU.extension);
    expect(n.plan).toBe("Test Budget as of 2026-11-15 19-51 - Plan.tsv");
    expect(n.register).toBe("Test Budget as of 2026-11-15 19-51 - Register.tsv");
  });
  it("writes the ticket's TSV line", () => {
    const e: RegisterEntry = {
      account: "Konto",
      accountRank: 0,
      date: "2026-11-30",
      amount: -120500,
      payee: "Laden",
      flag: null,
      cleared: "cleared",
      memo: null,
      category: { kind: "none" },
      lines: [],
      scheduled: false,
      createdAt: "a",
      id: "a",
    };
    const line = registerFile([e], EU).split("\r\n")[1];
    expect(line).toBe(
      '"Konto"\t""\t"30.11.2026"\t"Laden"\t""\t""\t""\t""\t120,50€\t0,00€\t"Cleared"',
    );
  });
});

describe("textField", () => {
  it("guards formulas and quotes", () => {
    expect(textField("=x")).toBe('"\\=x"');
    expect(textField("  +1")).toBe('"\\+1"');
    expect(textField("@a")).toBe('"\\@a"');
    expect(textField("-")).toBe('"\\-"');
    expect(textField("a=b")).toBe('"a=b"');
    expect(textField('say "hi"')).toBe('"say ""hi"""');
  });
});

describe("names", () => {
  it("makes the safe name", () => {
    expect(safeName("ZZ-TEST Ex/port: 7")).toBe("ZZ TEST Ex port 7");
    expect(safeName("a🛒b!")).toBe("a b ");
  });
  it("labels months", () => {
    expect(monthLabel("2026-01-01")).toBe("Jan 2026");
    expect(monthLabel("2026-12-01")).toBe("Dec 2026");
  });
  it("names the zip and entries", () => {
    expect(exportNames("ZZ-TEST Ex/port: 7", "2026-11-16T09:05", "csv")).toEqual({
      zip: "Budget Export - ZZ TEST Ex port 7 as of 2026-11-16 09-05.zip",
      plan: "ZZ TEST Ex port 7 as of 2026-11-16 09-05 - Plan.csv",
      register: "ZZ TEST Ex port 7 as of 2026-11-16 09-05 - Register.csv",
    });
  });
  it("checks now", () => {
    expect(ExportNow.safeParse("2026-11-16T09:05").success).toBe(true);
    for (const bad of [
      "2026-11-16 09:05",
      "2026-02-30T10:00",
      "2026-11-16T24:00",
      "2026-11-16T10:60",
      "1899-12-31T10:00",
    ]) {
      expect(ExportNow.safeParse(bad).success).toBe(false);
    }
  });
});

describe("planFile", () => {
  it("writes visible rows then hidden ones per month, with BOM and CRLF", () => {
    const cat = (name: string, hidden: boolean, a: number, b: number, c: number) => ({
      name,
      hidden,
      assigned: a,
      activity: b,
      available: c,
    });
    const text = planFile(
      [
        {
          month: "2026-10-01",
          groups: [
            {
              name: "Bills",
              hidden: false,
              categories: [cat("Rent", false, 900000, -900000, 0), cat("Old", true, 0, 0, 0)],
            },
            { name: "Gone", hidden: true, categories: [cat("Hobby", false, 0, 0, 0)] },
            {
              name: "Everyday",
              hidden: false,
              categories: [cat("Groceries 🛒", false, 300000, -120500, 179500)],
            },
          ],
        },
        {
          month: "2026-11-01",
          groups: [
            { name: "Bills", hidden: false, categories: [cat("Rent", false, 900000, 0, 900000)] },
          ],
        },
      ],
      US,
    );
    expect(text).toBe(
      [
        '﻿"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"',
        '"Oct 2026","Bills: Rent","Bills","Rent",$900.00,-$900.00,$0.00',
        '"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$300.00,-$120.50,$179.50',
        '"Oct 2026","Hidden Categories: Old","Hidden Categories","Old",$0.00,$0.00,$0.00',
        '"Oct 2026","Hidden Categories: Hobby","Hidden Categories","Hobby",$0.00,$0.00,$0.00',
        '"Nov 2026","Bills: Rent","Bills","Rent",$900.00,$0.00,$900.00',
      ].join("\r\n"),
    );
  });
});

describe("categoryCell", () => {
  it("follows the rules", () => {
    const joined = { group: "G", name: "N" };
    expect(categoryCell({ onBudget: false, categoryId: "c", inflowToRta: false, joined })).toEqual({
      kind: "none",
    });
    expect(categoryCell({ onBudget: true, categoryId: null, inflowToRta: true, joined })).toEqual({
      kind: "rta",
    });
    expect(categoryCell({ onBudget: true, categoryId: null, inflowToRta: false, joined })).toEqual({
      kind: "none",
    });
    expect(categoryCell({ onBudget: true, categoryId: "c", inflowToRta: false, joined })).toEqual({
      kind: "category",
      group: "G",
      name: "N",
      hidden: false,
    });
    expect(
      categoryCell({
        onBudget: true,
        categoryId: "c",
        inflowToRta: false,
        joined,
        known: { group: "K", name: "M", hidden: true },
      }),
    ).toEqual({ kind: "category", group: "K", name: "M", hidden: true });
  });
});

describe("registerFile", () => {
  let n = 0;
  const entry = (o: Partial<RegisterEntry>): RegisterEntry => ({
    account: "Main Checking",
    accountRank: 0,
    date: "2026-11-01",
    amount: 0,
    payee: "",
    flag: null,
    cleared: "cleared",
    memo: null,
    category: { kind: "none" },
    lines: [],
    scheduled: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: `id${n++}`,
    ...o,
  });
  const cat = (group: string, name: string): RegisterEntry["category"] => ({
    kind: "category",
    group,
    name,
    hidden: false,
  });
  const rta: RegisterEntry["category"] = { kind: "rta" };
  const label = (c: string) => (c === "red" ? "Red" : "Tax");

  it("writes the ticket's sample", () => {
    const entries = [
      entry({ date: "2026-11-01", amount: 1000000, payee: "Starting Balance", category: rta }),
      entry({
        date: "2026-11-05",
        amount: 2500000,
        payee: "Employer",
        memo: "=bonus",
        flag: "blue",
        category: rta,
      }),
      entry({
        account: "Rainy Day Savings",
        accountRank: 1,
        date: "2026-11-10",
        amount: 200000,
        payee: "Transfer : Main Checking",
        cleared: "reconciled",
      }),
      entry({
        date: "2026-11-10",
        amount: -200000,
        payee: "Transfer : Rainy Day Savings",
        cleared: "reconciled",
      }),
      entry({
        date: "2026-11-14",
        amount: -42500,
        payee: "Corner Shop",
        flag: "red",
        category: { kind: "none" },
        lines: [
          { payee: null, memo: "food", amount: -30000, category: cat("Everyday", "Groceries 🛒") },
          { payee: null, memo: null, amount: -12500, category: cat("Fun", "Games") },
        ],
      }),
      entry({
        date: "2026-12-01",
        amount: -900000,
        payee: "Landlord",
        memo: "monthly",
        cleared: "uncleared",
        scheduled: true,
        category: cat("Bills", "Rent"),
      }),
    ];
    const text = registerFile(entries, US, (c) => (c === "blue" ? "Tax" : label(c)));
    expect(text).toBe(
      [
        '﻿"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
        '"Main Checking","","12/01/2026","Landlord","Bills: Rent","Bills","Rent","monthly",$900.00,$0.00,"Uncleared"',
        '"Main Checking","Red","11/14/2026","Corner Shop","Everyday: Groceries 🛒","Everyday","Groceries 🛒","Split (1/2) food",$30.00,$0.00,"Cleared"',
        '"Main Checking","Red","11/14/2026","Corner Shop","Fun: Games","Fun","Games","Split (2/2) ",$12.50,$0.00,"Cleared"',
        '"Main Checking","","11/10/2026","Transfer : Rainy Day Savings","","","","",$200.00,$0.00,"Reconciled"',
        '"Rainy Day Savings","","11/10/2026","Transfer : Main Checking","","","","",$0.00,$200.00,"Reconciled"',
        '"Main Checking","Tax","11/05/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","\\=bonus",$0.00,$2500.00,"Cleared"',
        '"Main Checking","","11/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$1000.00,"Cleared"',
      ].join("\r\n"),
    );
  });

  it("orders same-date rows by signed amount, splits as one block by the parent's amount", () => {
    const entries = [
      entry({ amount: 7000, payee: "c" }),
      entry({ amount: -5000, payee: "b" }),
      entry({ amount: -60000, payee: "a" }),
      entry({
        amount: -20000,
        payee: "s",
        lines: [
          { payee: "s1", memo: null, amount: -5000, category: { kind: "none" } },
          { payee: null, memo: null, amount: -15000, category: { kind: "none" } },
        ],
      }),
    ];
    const payees = registerFile(entries, US)
      .split("\r\n")
      .slice(1)
      .map((l) => l.split(",")[3]);
    expect(payees).toEqual(['"a"', '"s1"', '"s"', '"b"', '"c"']);
  });

  it("breaks amount ties by account rank, then transactions before schedules", () => {
    const entries = [
      entry({ payee: "sched", scheduled: true, cleared: "uncleared", amount: -1000 }),
      entry({ payee: "second", accountRank: 1, amount: -1000 }),
      entry({ payee: "first", amount: -1000 }),
    ];
    const payees = registerFile(entries, US)
      .split("\r\n")
      .slice(1)
      .map((l) => l.split(",")[3]);
    expect(payees).toEqual(['"first"', '"sched"', '"second"']);
  });

  it("keeps quotes, commas, line breaks and emoji inside a quoted memo", () => {
    const text = registerFile([entry({ memo: 'a "q", b\nc 🛒', amount: 1000 })], US);
    expect(text.split("\r\n")[1]).toBe(
      '"Main Checking","","11/01/2026","","","","","a ""q"", b\nc 🛒",$0.00,$1.00,"Cleared"',
    );
  });
});

describe("EXF-670 now bound", () => {
  it("accepts the server's date and one calendar day either side", () => {
    expect(nowWithinServerDays("2026-11-16T09:05", "2026-11-16")).toBe(true);
    expect(nowWithinServerDays("2026-11-17T23:59", "2026-11-16")).toBe(true);
    expect(nowWithinServerDays("2026-11-15T00:00", "2026-11-16")).toBe(true);
    expect(nowWithinServerDays("2026-11-18T00:00", "2026-11-16")).toBe(false);
    expect(nowWithinServerDays("2026-11-14T23:59", "2026-11-16")).toBe(false);
    expect(nowWithinServerDays("2199-12-31T23:59", "2026-11-16")).toBe(false);
  });
  it("crosses month and year ends", () => {
    expect(nowWithinServerDays("2027-01-01T00:00", "2026-12-31")).toBe(true);
    expect(nowWithinServerDays("2026-12-31T00:00", "2027-01-01")).toBe(true);
    expect(nowRangeText("2026-12-31")).toBe("2026-12-30 to 2027-01-01");
    expect(nowRangeText("2026-11-16")).toBe("2026-11-15 to 2026-11-17");
  });
  it("the month ceiling is the server's month plus 24", () => {
    expect(exportMonthCeiling("2026-11-16")).toBe("2028-11-01");
    expect(exportMonthCeiling("2026-12-31")).toBe("2028-12-01");
    expect(exportMonthCeiling("2026-01-05")).toBe("2028-01-01");
  });
});

describe("SYSTEM_PAYEE_NAMES", () => {
  it("covers every system payee, under distinct names (EXF-723)", () => {
    expect(Object.keys(SYSTEM_PAYEE_NAMES).sort()).toEqual([...PAYEE_SYSTEMS].sort());
    const names = Object.values(SYSTEM_PAYEE_NAMES);
    expect(new Set(names).size).toBe(names.length);
    expect(SYSTEM_PAYEE_NAMES).toEqual({
      starting_balance: "Starting Balance",
      manual_adjustment: "Manual Balance Adjustment",
      reconciliation_adjustment: "Reconciliation Balance Adjustment",
    });
  });
});
