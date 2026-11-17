import { env } from "cloudflare:test";
import { isOnBudget } from "@budget/core/account-types";
import { IMPORT_ON_BUDGET } from "@budget/schema/plan-import";
import { describe, expect, it } from "vitest";
import { type Json, q, tool } from "./bulk-helpers";
import { json } from "./helpers";
import { pinPlanClock } from "./plan-export-helpers";
import {
  allCounts,
  BOM,
  body,
  importForm,
  PLAN_HEADER,
  postImport,
  REGISTER_HEADER,
  r2Keys,
  SAMPLE_ZIP_NAME,
  sampleFiles,
  sampleZip,
} from "./plan-import-helpers";
import { apiPaths, listedToolNames } from "./surface";

// EXF-477 (API half), cases 1 to 6 and 12 of docs/plan-import-design.md. The files are written by hand from the
// tickets' text; the clone's own export is used for the round trip in plan-import-roundtrip.test.ts.
pinPlanClock();

const importSample = async (fields: Record<string, string> = {}) => {
  const zip = await sampleZip();
  return postImport(importForm([{ name: SAMPLE_ZIP_NAME, data: zip }], fields));
};
const get = async (path: string) => ((await (await json(path)).json()) as Json).data;

describe("case 1 (criterion 1): the sample", () => {
  it("creates the plan with its accounts, groups, categories, assignments, split, transfer and schedule", async () => {
    const res = await importSample();
    const data = await body(res, 201);
    expect(data.state).toBe("done");
    const bid = data.budget_id as string;
    expect(data.summary.name).toBe("Sample Plan");
    expect(data.summary.export_date).toBe("2026-11-15");

    const plan = (await get(`/api/v1/budgets/${bid}`)).budget;
    expect(plan.name).toBe("Sample Plan");
    const accounts = (await get(`/api/v1/budgets/${bid}/accounts`)).accounts as Json[];
    expect(accounts.map((a) => [a.name, a.type, a.closed]).sort()).toEqual([
      ["Main Checking", "checking", false],
      ["Rainy Day Savings", "checking", false],
      ["Sample Visa", "creditCard", false],
    ]);
    const visa = accounts.find((a) => a.name === "Sample Visa") as Json;
    expect(
      (await q("select count(*) n from transactions where account_id = ?", visa.id))[0]?.n,
    ).toBe(0);
    const codes = data.summary.warnings.map((w: Json) => w.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "card_without_account",
        "category_not_in_plan_file",
        "flag_name_unknown",
      ]),
    );

    const month = await get(`/api/v1/budgets/${bid}/months/2026-10-01`);
    const groups = month.groups.map((g: Json) => [
      g.name,
      g.kind,
      g.categories.map((c: Json) => [c.name, c.hidden]),
    ]);
    expect(groups).toEqual([
      ["Credit Card Payments", "credit_card_payments", [["Sample Visa", false]]],
      ["Bills", null, [["Rent", false]]],
      ["Everyday", null, [["Groceries 🛒", false]]],
      ["Fun", null, [["Games", false]]],
      ["Hidden Categories", null, [["Old Hobby", true]]],
    ]);
    const cat = (name: string) =>
      month.groups.flatMap((g: Json) => g.categories).find((c: Json) => c.name === name) as Json;
    expect(cat("Rent").assigned).toBe(900000);
    expect(cat("Groceries 🛒").assigned).toBe(300000);
    // Assigned per month, by SQL: Oct Rent $900.00, Oct Groceries $300.00, Nov Rent $900.00 and nothing else.
    const assigned = await q(
      "select m.month, c.name, m.assigned from month_categories m join categories c on c.id = m.category_id where m.budget_id = ? order by m.month, c.name",
      bid,
    );
    expect(assigned.map((r) => [r.month, r.name, r.assigned])).toEqual([
      ["2026-10-01", "Groceries 🛒", 300000],
      ["2026-10-01", "Rent", 900000],
      ["2026-11-01", "Rent", 900000],
    ]);

    // One two-way split: parent -42.50 red, lines -30.00 "food" and -12.50 without memo.
    const parents = await q(
      "select id, amount, flag_color, payee_name from transactions where budget_id = ? and id in (select parent_transaction_id from transactions where budget_id = ?)",
      bid,
      bid,
    );
    expect(parents).toHaveLength(1);
    expect(parents[0]).toMatchObject({
      amount: -42500,
      flag_color: "red",
      payee_name: "Corner Shop",
    });
    const lines = await q(
      "select amount, memo, split_index, flag_color from transactions where parent_transaction_id = ? order by split_index",
      parents[0]?.id,
    );
    expect(lines.map((l) => [l.amount, l.memo, l.split_index])).toEqual([
      [-30000, "food", 0],
      [-12500, null, 1],
    ]);

    // One paired transfer, reconciled on both sides.
    const xfer = await q(
      "select id, amount, cleared, transfer_transaction_id, transfer_account_id, payee_id, payee_name, category_id from transactions where budget_id = ? and transfer_account_id is not null order by amount",
      bid,
    );
    expect(xfer).toHaveLength(2);
    expect(xfer.map((x) => [x.amount, x.cleared, x.payee_id, x.payee_name])).toEqual([
      [-200000, "reconciled", null, "Transfer : Rainy Day Savings"],
      [200000, "reconciled", null, "Transfer : Main Checking"],
    ]);
    expect(xfer[0]?.transfer_transaction_id).toBe(xfer[1]?.id);
    expect(xfer[1]?.transfer_transaction_id).toBe(xfer[0]?.id);

    // One scheduled transaction on 12/01/2026, one-off, -900.00.
    const sched = await q("select * from scheduled_transactions where budget_id = ?", bid);
    expect(sched).toHaveLength(1);
    expect(sched[0]).toMatchObject({
      date_next: "2026-12-01",
      date_first: "2026-12-01",
      amount: -900000,
      frequency: "never",
      memo: "monthly",
    });

    // The flag "Tax" is no colour: no flag, with the warning; the Starting Balance payee is the system payee.
    const employer = (
      await q(
        "select flag_color, memo, inflow_to_ready_to_assign, approved from transactions where budget_id = ? and payee_name = 'Employer'",
        bid,
      )
    )[0];
    expect(employer).toMatchObject({
      flag_color: null,
      memo: "=bonus",
      inflow_to_ready_to_assign: 1,
      approved: 1,
    });
    expect(
      (
        await q("select system from payees where budget_id = ? and name = 'Starting Balance'", bid)
      )[0]?.system,
    ).toBe("starting_balance");

    // One history row, the actor and the summary.
    const log = await q(
      "select actor, action, entity_type, after_json from change_log where budget_id = ?",
      bid,
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actor: "user:tester@localhost",
      action: "create",
      entity_type: "budget",
    });
    const after = JSON.parse(log[0]?.after_json);
    expect(after.import.text).toBe("Imported plan from file");
    expect(after.import.counts.splits).toBe(1);
    expect(await r2Keys()).toEqual([]);
  });

  it("the plan is in the list, and its register is readable", async () => {
    const data = await body(await importSample(), 201);
    const list = await get("/api/v1/budgets");
    expect(list.budgets.map((b: Json) => b.id)).toContain(data.budget_id);
    const txs = await get(`/api/v1/budgets/${data.budget_id}/transactions`);
    expect(JSON.stringify(txs)).toContain("Corner Shop");
  });

  it("the same files as two parts (a .csv pair, either order) and through the tool", async () => {
    const f = sampleFiles();
    const a = await body(
      await postImport(
        importForm([
          { name: "Sample Plan as of 2026-11-15 19-51 - Register.csv", data: f.register },
          { name: "Sample Plan as of 2026-11-15 19-51 - Plan.csv", data: f.plan },
        ]),
      ),
      201,
    );
    expect(a.summary.name).toBe("Sample Plan");
    expect(a.summary.export_date).toBe("2026-11-15");
    const zip = await sampleZip();
    const r = await tool("import_budget_export", {
      files: [{ file_name: SAMPLE_ZIP_NAME, content_base64: btoa(String.fromCharCode(...zip)) }],
      name: "ZZ-TEST imported by tool",
    });
    expect(r.result.isError, JSON.stringify(r.result)).toBeFalsy();
    const out = JSON.parse(r.result.content[0].text);
    expect(out.state).toBe("done");
    expect((await get(`/api/v1/budgets/${out.budget_id}`)).budget.name).toBe(
      "ZZ-TEST imported by tool",
    );
  });

  it("refuses what is not an export", async () => {
    const bad = await postImport(importForm([{ name: "x.csv", data: "a,b\r\n1,2" }]));
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as Json).error.detail).toContain("Export Plan");
    const none = await postImport(importForm([]));
    expect(none.status).toBe(422);
  });
});

describe("case 2 (criterion 2): amounts", () => {
  it("a TSV pair with € after the amount, comma decimals and DD.MM.YYYY dates", async () => {
    const t = (cells: string[]) => cells.join("\t");
    const plan = [
      t(PLAN_HEADER.split(",")),
      t([
        '"Okt 2026"',
        '"Alltag: Essen"',
        '"Alltag"',
        '"Essen"',
        "100,00€",
        "-17,34€",
        "82,66€",
      ]).replace("Okt", "Oct"),
    ].join("\r\n");
    const register = [
      t(REGISTER_HEADER.split(",")),
      t([
        '"Konto"',
        '""',
        '"30.10.2026"',
        '"Laden"',
        '"Alltag: Essen"',
        '"Alltag"',
        '"Essen"',
        '""',
        "17,34€",
        "0,00€",
        '"Cleared"',
      ]),
      t([
        '"Konto"',
        '""',
        '"29.10.2026"',
        '"Chef"',
        '"Inflow: Ready to Assign"',
        '"Inflow"',
        '"Ready to Assign"',
        '""',
        "0,00€",
        "120,50€",
        '"Cleared"',
      ]),
    ].join("\r\n");
    const data = await body(
      await postImport(
        importForm(
          [
            { name: "Mein Plan as of 2026-11-15 19-51 - Plan.tsv", data: BOM + plan },
            { name: "Mein Plan as of 2026-11-15 19-51 - Register.tsv", data: BOM + register },
          ],
          {},
        ),
      ),
      201,
    );
    expect(data.summary.formats).toMatchObject({
      currency_symbol: "€",
      symbol_placement: "after",
      decimal_separator: ",",
      decimal_digits: 2,
      delimiter: "tab",
      date_format: "DD.MM.YYYY",
    });
    const rows = await q(
      "select payee_name, amount, date from transactions where budget_id = ? order by date",
      data.budget_id,
    );
    expect(rows.map((r) => [r.payee_name, r.amount, r.date])).toEqual([
      ["Chef", 120500, "2026-10-29"],
      ["Laden", -17340, "2026-10-30"],
    ]);
    expect(data.summary.mismatch_count).toBe(0);
  });

  it("a $17.34 amount is exactly 17340", async () => {
    const f = sampleFiles();
    const register = f.register.replace("$30.00", "$17.34").replace("$12.50", "$0.00");
    const data = await body(
      await postImport(
        importForm([
          { name: "a as of 2026-11-15 19-51 - Plan.csv", data: f.plan },
          { name: "a as of 2026-11-15 19-51 - Register.csv", data: register },
        ]),
      ),
      201,
    );
    const amounts = await q(
      "select amount from transactions where budget_id = ? and split_index = 0",
      data.budget_id,
    );
    expect(amounts[0]?.amount).toBe(-17340);
  });

  it("an amount that is not one is a 422 naming file, line and column", async () => {
    const f = sampleFiles();
    const res = await postImport(
      importForm([
        { name: "p.csv", data: f.plan },
        {
          name: "r.csv",
          data: f.register.replace('$900.00,$0.00,"Uncleared"', '$9.0.0,$0.00,"Uncleared"'),
        },
      ]),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.detail).toMatch(
      /Register file line 2, column Outflow/,
    );
  });
});

describe("amounts with thousands separators (second carry-over, spec task 13)", () => {
  const files = (outflow = '"$12,345.00"') => ({
    plan: [
      PLAN_HEADER,
      '"Oct 2026","Bills: Rent","Bills","Rent","$1,234.56","-$12,345.00","-$11,110.44"',
    ].join("\r\n"),
    register: [
      REGISTER_HEADER,
      `"Main Checking","","10/15/2026","Landlord","Bills: Rent","Bills","Rent","",${outflow},$0.00,"Cleared"`,
      '"Main Checking","","10/01/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,"$1,000,000.00","Cleared"',
    ].join("\r\n"),
  });
  const post = (f: { plan: string; register: string }) =>
    postImport(
      importForm([
        { name: "g as of 2026-11-15 19-51 - Plan.csv", data: f.plan },
        { name: "g as of 2026-11-15 19-51 - Register.csv", data: f.register },
      ]),
    );

  it("imports grouped amounts to the milliunit", async () => {
    const data = await body(await post(files()), 201);
    // By hand: 1,234.56 assigned; 12,345.00 out; 1,000,000.00 in.
    const assigned = await q(
      "select sum(assigned) s from month_categories where budget_id = ?",
      data.budget_id,
    );
    expect(assigned[0]?.s).toBe(1234560);
    const total = await q(
      "select sum(amount) s from transactions where budget_id = ?",
      data.budget_id,
    );
    expect(total[0]?.s).toBe(987655000);
    expect(data.summary.mismatch_count).toBe(0);
  });

  it("a wrong grouping is a 422 naming file, line, column and text, and writes nothing", async () => {
    const before = await allCounts();
    const res = await post(files('"$1,23.45"'));
    expect(res.status).toBe(422);
    const detail = ((await res.json()) as Json).error.detail as string;
    expect(detail).toContain("Register file line 2, column Outflow");
    expect(detail).toContain("$1,23.45");
    expect(await allCounts()).toEqual(before);
  });
});

describe("case 3 (criterion 3): the formula guard", () => {
  it("imports \\=bonus as =bonus", async () => {
    const data = await body(await importSample(), 201);
    const r = await q(
      "select memo from transactions where budget_id = ? and payee_name = 'Employer'",
      data.budget_id,
    );
    expect(r[0]?.memo).toBe("=bonus");
  });
});

describe("case 4 (criterion 4): dates", () => {
  const ambiguous = () => {
    const register = [
      REGISTER_HEADER,
      '"Main","","05/06/2026","Shop","","","","",$5.00,$0.00,"Cleared"',
      '"Main","","04/03/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"',
    ].join("\r\n");
    return [
      { name: "A as of 2026-11-15 19-51 - Plan.csv", data: BOM + [PLAN_HEADER].join("\r\n") },
      { name: "A as of 2026-11-15 19-51 - Register.csv", data: BOM + register },
    ];
  };
  it("asks in the dry run, refuses a real import, and takes date_format", async () => {
    const preview = await body(await postImport(importForm(ambiguous()), "?dry_run=true"), 200);
    expect(preview.date_question.first_transaction).toBe("05/06/2026");
    expect(preview.date_question.options).toEqual([
      { date_format: "MM/DD/YYYY", date: "2026-05-06" },
      { date_format: "DD/MM/YYYY", date: "2026-06-05" },
    ]);
    expect(preview.date_question.question).toBe(
      `The date format of A as of 2026-11-15 19-51 - Register.csv is unclear. The first transaction reads 05/06/2026. What date is this?`,
    );
    const refused = await postImport(importForm(ambiguous()));
    expect(refused.status).toBe(422);
    const err = ((await refused.json()) as Json).error;
    expect(err.name).toBe("date_format_unclear");
    expect(err.detail).toContain("The first transaction reads 05/06/2026");
    expect(err.detail).toContain("DD/MM/YYYY (2026-06-05)");
    const ok = await body(
      await postImport(importForm(ambiguous(), { date_format: "DD/MM/YYYY" })),
      201,
    );
    const dates = await q(
      "select date from transactions where budget_id = ? order by date",
      ok.budget_id,
    );
    expect(dates.map((d) => d.date)).toEqual(["2026-03-04", "2026-06-05"]);
  });
  it("the sample (a day of 14) has no question", async () => {
    const zip = await sampleZip();
    const preview = await body(
      await postImport(importForm([{ name: SAMPLE_ZIP_NAME, data: zip }]), "?dry_run=true"),
      200,
    );
    expect(preview.date_question).toBeNull();
    expect(preview.formats.date_format).toBe("MM/DD/YYYY");
  });
});

describe("case 6 (criterion 6): dry run writes nothing", () => {
  it("leaves every table and R2 as it was, and returns the preview", async () => {
    const before = await allCounts();
    const keys = await r2Keys();
    const zip = await sampleZip();
    const preview = await body(
      await postImport(importForm([{ name: SAMPLE_ZIP_NAME, data: zip }]), "?dry_run=true"),
      200,
    );
    expect(await allCounts()).toEqual(before);
    expect(await r2Keys()).toEqual(keys);
    expect(preview.formats).toMatchObject({
      currency_symbol: "$",
      symbol_placement: "before",
      decimal_separator: ".",
      date_format: "MM/DD/YYYY",
      delimiter: "comma",
    });
    expect(preview.accounts.map((a: Json) => [a.name, a.proposed_type])).toEqual([
      ["Main Checking", "checking"],
      ["Rainy Day Savings", "checking"],
      ["Sample Visa", "creditCard"],
    ]);
    expect(preview.counts).toMatchObject({
      accounts: 3,
      months: 2,
      splits: 1,
      transfers_paired: 1,
      scheduled: 1,
    });
    expect(preview.warning_count).toBeGreaterThan(0);
    expect(preview).toHaveProperty("mismatches");
    const viaTool = await tool("import_budget_export", {
      files: [{ file_name: SAMPLE_ZIP_NAME, content_base64: btoa(String.fromCharCode(...zip)) }],
      dry_run: true,
    });
    expect(JSON.parse(viaTool.result.content[0].text).counts.splits).toBe(1);
    expect(await allCounts()).toEqual(before);
  });
});

describe("case 12: options and warnings", () => {
  const withRegister = (lines: string[]) => [
    { name: "X as of 2026-11-15 19-51 - Plan.csv", data: sampleFiles().plan },
    {
      name: "X as of 2026-11-15 19-51 - Register.csv",
      data: BOM + [REGISTER_HEADER, ...lines].join("\r\n"),
    },
  ];
  it("account_types: savings is applied; mortgage and unknown names are 422", async () => {
    const zip = await sampleZip();
    const ok = await body(
      await postImport(
        importForm([{ name: SAMPLE_ZIP_NAME, data: zip }], {
          account_types: JSON.stringify({ "Main Checking": "savings" }),
        }),
      ),
      201,
    );
    expect(
      (
        await q(
          "select type from accounts where budget_id = ? and name = 'Main Checking'",
          ok.budget_id,
        )
      )[0]?.type,
    ).toBe("savings");
    for (const types of [
      { "Main Checking": "mortgage" },
      { Nobody: "savings" },
      { "Sample Visa": "checking" },
    ]) {
      const res = await postImport(
        importForm([{ name: SAMPLE_ZIP_NAME, data: zip }], {
          account_types: JSON.stringify(types),
        }),
      );
      expect(res.status, JSON.stringify(types)).toBe(422);
    }
  });
  it("name and export_date override the file name", async () => {
    const zip = await sampleZip();
    const data = await body(
      await postImport(
        importForm([{ name: SAMPLE_ZIP_NAME, data: zip }], {
          name: "ZZ-TEST Mine",
          export_date: "2026-12-15",
        }),
      ),
      201,
    );
    expect(data.summary.name).toBe("ZZ-TEST Mine");
    expect(data.summary.export_date).toBe("2026-12-15");
    // The row dated 12/01/2026 is before that export date now: a transaction, not a schedule.
    expect(data.summary.counts.scheduled).toBe(0);
    expect(
      (
        await q("select count(*) n from scheduled_transactions where budget_id = ?", data.budget_id)
      )[0]?.n,
    ).toBe(0);
  });
  it("a loan-like account becomes a tracking liability with a warning", async () => {
    const data = await body(
      await postImport(
        importForm(
          withRegister([
            '"Car Loan","","10/01/2026","Starting Balance","","","","",$5000.00,$0.00,"Cleared"',
            '"Main Checking","","10/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"',
          ]),
        ),
        "?dry_run=true",
      ),
      200,
    );
    expect(data.accounts.find((a: Json) => a.name === "Car Loan")).toMatchObject({
      type: "otherLiability",
      on_budget: false,
    });
    expect(data.warnings.map((w: Json) => w.code)).toContain("loan_as_tracking_liability");
  });
  it("a card's row in its own payment category is imported uncategorized, with a warning", async () => {
    const data = await body(
      await postImport(
        importForm(
          withRegister([
            '"Sample Visa","","10/10/2026","Bank","Credit Card Payments: Sample Visa","Credit Card Payments","Sample Visa","",$5.00,$0.00,"Cleared"',
          ]),
        ),
      ),
      201,
    );
    const r = await q(
      "select category_id, inflow_to_ready_to_assign from transactions where budget_id = ?",
      data.budget_id,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ category_id: null, inflow_to_ready_to_assign: 0 });
    expect(data.summary.warnings.map((w: Json) => w.code)).toContain("card_own_payment_category");
  });
  it("IMPORT_ON_BUDGET agrees with the core's isOnBudget", () => {
    for (const [t, on] of Object.entries(IMPORT_ON_BUDGET))
      expect(isOnBudget(t as never), t).toBe(on);
  });
  it("the surface lists the three operations and tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/import",
        "/api/v1/budgets/import/{import_id}/continue",
        "/api/v1/budgets/import/{import_id}",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "import_budget_export",
        "continue_budget_import",
        "cancel_budget_import",
      ]),
    );
    void env;
  });
});
