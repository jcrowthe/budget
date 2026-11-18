import { describe, expect, it } from "vitest";
import { exportFileName, REGISTER_CSV_HEADER, registerCsv } from "../src/register-export";
import type { PlanTransaction } from "../src/transactions";

const base: PlanTransaction = {
  id: "1",
  budget_id: "b",
  account_id: "a",
  account_name: "ZZ Checking",
  date: "2026-11-09",
  payee_id: null,
  payee_name: "ZZ Shop",
  category_id: "c",
  category_name: "Groceries",
  category_group_name: "Needs",
  inflow_to_ready_to_assign: false,
  memo: null,
  amount: -4500,
  cleared: "uncleared",
  approved: true,
  created_at: "x",
  updated_at: "x",
  match_details: null,
  import_id: null,
  source: null,
  imported_payee: null,
  bank_description: null,
  matched: false,
  flag_color: null,
  payee_system: null,
  transfer_account_id: null,
  transfer_transaction_id: null,
  transfer_account_name: null,
  subtransactions: [],
};
const body = (rows: PlanTransaction[]) => registerCsv(rows).replace("﻿", "").trimEnd().split("\n");

describe("registerCsv", () => {
  it("starts with a BOM and the ticket's header", () => {
    expect(registerCsv([]).startsWith("﻿")).toBe(true);
    expect(body([])[0]).toBe(
      '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
    );
    expect(REGISTER_CSV_HEADER).toHaveLength(11);
  });
  it("writes an outflow, with the group and category", () => {
    expect(body([base])[1]).toBe(
      '"ZZ Checking","","11/09/2026","ZZ Shop","Needs: Groceries","Needs","Groceries","","$4.50","$0.00","Uncleared"',
    );
  });
  it("writes a flag's name, an inflow, Ready to Assign and a quote in a memo", () => {
    const line = body([
      {
        ...base,
        flag_color: "red",
        amount: 1234560,
        cleared: "reconciled",
        category_id: null,
        category_name: null,
        category_group_name: null,
        inflow_to_ready_to_assign: true,
        memo: 'a "b"',
      },
    ])[1];
    expect(line).toBe(
      '"ZZ Checking","Red","11/09/2026","ZZ Shop","Inflow: Ready to Assign","Inflow","Ready to Assign","a ""b""","$0.00","$1234.56","Reconciled"',
    );
  });
  it("writes one line per line of a split", () => {
    const line = (amount: number, memo: string | null) => ({
      id: "l",
      amount,
      payee_id: null,
      payee_name: null,
      category_id: "c",
      category_name: "Groceries",
      category_group_name: "Needs",
      inflow_to_ready_to_assign: false,
      memo,
    });
    const rows = body([
      { ...base, memo: "p", amount: -300, subtransactions: [line(-100, "one"), line(-200, null)] },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('"Split (1/2) one"');
    expect(rows[2]).toContain('"Split (2/2) p"');
    expect(rows[2]).toContain('"$0.20"');
  });
  it("writes a transfer with its payee and no category", () => {
    const line = body([
      {
        ...base,
        payee_name: "Transfer : ZZ Savings",
        category_id: null,
        category_name: null,
        category_group_name: null,
        transfer_account_id: "s",
      },
    ])[1];
    expect(line).toContain('"Transfer : ZZ Savings","","",""');
  });
});

describe("exportFileName", () => {
  it("names the plan and the minute", () => {
    const at = new Date(Date.UTC(2026, 10, 9, 7, 5));
    expect(exportFileName("My Plan", at, "utc")).toBe(
      "Selected Transactions for My Plan as of 2026-11-09 07-05.csv",
    );
    expect(exportFileName("P", new Date(2026, 0, 2, 3, 4), "local")).toBe(
      "Selected Transactions for P as of 2026-01-02 03-04.csv",
    );
  });
});
