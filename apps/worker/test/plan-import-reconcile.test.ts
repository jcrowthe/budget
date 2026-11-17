import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { pinPlanClock } from "./plan-export-helpers";
import { body, importForm, postImport, sampleFiles } from "./plan-import-helpers";
import { reconcile } from "./reconcile-helpers";

// EXF-723: a hand-written file in the source's style with reconciliation adjustment rows imports onto the plan's
// one `reconciliation_adjustment` system payee, the row a later reconcile in the new plan then uses.
pinPlanClock();
const SRC = ["YN", "AB"].join("");
const memo = ["Entered automatically by ", SRC].join("");
const ADJ = (account: string, date: string, amount: string) =>
  `"${account}","","${date}","Reconciliation Balance Adjustment","Inflow: Ready to Assign","Inflow","Ready to Assign","${memo}",$0.00,${amount},"Reconciled"`;

describe("import of reconciliation adjustment rows", () => {
  it("puts them on one system payee, and a later reconcile creates no second one", async () => {
    const { plan, register } = sampleFiles();
    const reg = [
      register,
      ADJ("Main Checking", "11/12/2026", "$5.00"),
      ADJ("Rainy Day Savings", "11/13/2026", "$3.00"),
    ].join("\r\n");
    const data = await body(
      await postImport(
        importForm([
          { name: "Sample Plan as of 2026-11-15 19-51 - Plan.csv", data: plan },
          { name: "Sample Plan as of 2026-11-15 19-51 - Register.csv", data: reg },
        ]),
      ),
      201,
    );
    const nb = data.budget_id as string;
    const payees = (await q(
      "select id from payees where budget_id = ? and system = 'reconciliation_adjustment'",
      nb,
    )) as Json[];
    expect(payees).toHaveLength(1);
    const rows = (await q(
      "select payee_id from transactions where budget_id = ? and payee_name = 'Reconciliation Balance Adjustment'",
      nb,
    )) as Json[];
    expect(rows.map((r) => r.payee_id)).toEqual([payees[0]?.id, payees[0]?.id]);
    expect(
      (
        (await q(
          "select count(*) n from payees where budget_id = ? and name = 'Reconciliation Balance Adjustment' and system is null",
          nb,
        )) as Json[]
      )[0]?.n,
    ).toBe(0);

    const accts = (await (await json(`/api/v1/budgets/${nb}/accounts`)).json()) as Json;
    const main = accts.data.accounts.find((a: Json) => a.name === "Main Checking");
    const one = (await (await json(`/api/v1/budgets/${nb}/accounts/${main.id}`)).json()) as Json;
    const rec = await reconcile(nb, main.id, {
      statement_balance: one.data.account.cleared_balance - 1000,
      create_adjustment: true,
      today: "2026-11-16",
    });
    expect(rec.status).toBe(200);
    const after = (await q(
      "select id from payees where budget_id = ? and system = 'reconciliation_adjustment'",
      nb,
    )) as Json[];
    expect(after.map((p) => p.id)).toEqual([payees[0]?.id]);
    const res = (await rec.json()) as Json;
    expect(res.data.adjustment.payee_id).toBe(payees[0]?.id);
  });
});
