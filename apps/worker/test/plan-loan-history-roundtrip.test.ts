import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { activity, balanceOf, update } from "./loan-update-world";
import { D15, MORTGAGE, newPlan, openAccount, pay, send } from "./loan-world";
import { NOW, pinPlanClock, readZip } from "./plan-export-helpers";
import { body, importForm, postImport } from "./plan-import-helpers";

// A loan's recorded history (Update-Balance freeze, Add Interest, an edited interest line, a fee, a credit and a
// pairing made with new_category) goes through Export Plan and Import Plan and reads the same on the loan page.
pinPlanClock();

const act = (bid: string, loan: string) => `/api/v1/budgets/${bid}/accounts/${loan}/activity`;
const MONTHS = ["2026-09-01", "2026-10-01", "2026-11-01"];

async function view(bid: string, loanId: string) {
  const months: Json[] = [];
  for (const m of MONTHS) {
    const a = await activity(bid, loanId, m);
    months.push({
      m,
      interest: a.interest && { amount: a.interest.amount, state: a.interest.state },
      escrow: a.escrow && { amount: a.escrow.amount, state: a.escrow.state },
      other: a.other.map((o) => ({
        label: o.label,
        date: o.date,
        amount: o.amount,
        memo: o.memo,
        reconciled: o.reconciled,
      })),
    });
  }
  return { balance: await balanceOf(bid, loanId), months };
}

describe("a loan's frozen, edited and paired history survives export and import", () => {
  it("the imported loan page equals the source's", async () => {
    const bid = await newPlan();
    const checking = await openAccount(bid, {
      name: "Checking",
      type: "checking",
      balance: 50000000,
    });
    const loan = await openAccount(bid, {
      ...MORTGAGE,
      date: "2026-09-10",
      name: "Mortgage",
      new_category: { name: "ZZ Mortgage Pay", new_group_name: "ZZ Loans" },
    });
    const ok = async (r: Response) => {
      expect(r.status, await r.clone().text()).toBeLessThan(300);
      return r;
    };
    for (const date of ["2026-09-20", "2026-10-15", D15]) {
      await ok(await pay(bid, loan.id, { from_account_id: checking.id, amount: 1500000, date }));
    }
    // Update Balance freezes November's interest and escrow as Reconciled.
    await ok(await update(bid, loan.id, { balance: await balanceOf(bid, loan.id), today: D15 }));
    // Add Interest for October (Edited), then edit the line; a fee and a credit.
    await ok(
      await send(act(bid, loan.id), "POST", {
        kind: "interest",
        amount: 50000,
        month: "2026-10-01",
        today: D15,
      }),
    );
    const line = (await activity(bid, loan.id, "2026-10-01")).interest?.transaction_id as string;
    await ok(await send(`${act(bid, loan.id)}/${line}`, "PATCH", { amount: 1075000, today: D15 }));
    await ok(
      await send(act(bid, loan.id), "POST", {
        kind: "fee",
        amount: 25000,
        date: "2026-10-20",
        memo: "ZZ-TEST late fee",
        today: D15,
      }),
    );
    await ok(
      await send(act(bid, loan.id), "POST", {
        kind: "credit",
        amount: 10000,
        date: "2026-09-25",
        memo: "ZZ-TEST refund",
        today: D15,
      }),
    );

    const src = await view(bid, loan.id);
    const states = src.months.flatMap((m) => [m.interest?.state, m.escrow?.state]);
    expect(states).toContain("reconciled");
    expect(states).toContain("edited");

    const res = await json(`/api/v1/budgets/${bid}/export?now=${encodeURIComponent(NOW)}`);
    expect(res.status).toBe(200);
    const name = /filename="([^"]+)"/.exec(
      res.headers.get("Content-Disposition") ?? "",
    )?.[1] as string;
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(readZip(bytes).length).toBe(2);
    const imp = await body(
      await postImport(importForm([{ name, data: bytes }], { date_format: "MM/DD/YYYY" })),
      201,
    );

    const newLoan = (
      await q("select id from accounts where budget_id = ? and type = 'mortgage'", imp.budget_id)
    )[0]?.id as string;
    const got = await view(imp.budget_id, newLoan);
    expect(got).toEqual(src);
    // The system payees stay system payees (no ordinary "Loan Interest" payee), and the pairing is kept.
    const sys = await q(
      "select system, count(*) n from payees where budget_id = ? and system in ('loan_interest','loan_escrow') group by system",
      imp.budget_id,
    );
    expect(sys.map((r) => r.system).sort()).toEqual(["loan_escrow", "loan_interest"]);
    const paired = await q(
      `select c.name cat, g.name grp from accounts a join categories c on c.id = a.paired_category_id
         join category_groups g on g.id = c.group_id where a.id = ?`,
      newLoan,
    );
    expect(paired[0]).toMatchObject({ cat: "ZZ Mortgage Pay", grp: "ZZ Loans" });
  });
});
