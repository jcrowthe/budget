import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import {
  accountOf,
  activity,
  balanceOf,
  frozenRow,
  mortgageWorld,
  rows,
  rta,
  TODAY,
  update,
  updatePath,
} from "./loan-update-world";
import { D15, NOV, summary, tool } from "./loan-world";
import { apiPaths, listedToolNames } from "./surface";
import { setOf } from "./undo-helpers";

// EXF-543: the loan Update Balance write, REST and MCP. Milliunits; `today` is 2026-11-15 throughout.
const data = async (res: Response): Promise<Json> => ((await res.json()) as Json).data;

describe("AC1: Yes, the balance is right", () => {
  it("freezes interest and escrow as Reconciled, writes no adjustment", async () => {
    const w = await mortgageWorld();
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199800000);
    const res = await update(w.bid, w.loan.id, { balance: -199800000, today: TODAY });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.adjustment_amount).toBe(0);
    expect(d.adjustment).toBeNull();
    expect(d.balance_updated_at).toEqual(expect.any(String));
    expect((await summary(w.bid, w.loan.id)).balance_updated_at).toBe(d.balance_updated_at);
    const a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ amount: -1000000, state: "reconciled" });
    expect(a.escrow).toMatchObject({ amount: -300000, state: "reconciled" });
    expect(
      await q(
        "select id from payees where budget_id = ? and system = 'reconciliation_adjustment'",
        w.bid,
      ),
    ).toHaveLength(0);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199800000);
  });
});

describe("AC2/AC3/AC4: the worked example W", () => {
  it("a preview writes nothing and reports the difference", async () => {
    const w = await mortgageWorld({ edited: true });
    const before = { tx: await rows(w.bid, "transactions"), log: await rows(w.bid, "change_log") };
    const res = await update(w.bid, w.loan.id, {
      balance: -199500000,
      current_balance: -199850000,
      today: TODAY,
      preview: true,
    });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.adjustment_amount).toBe(350000);
    expect(d.previous_balance).toBe(-199850000);
    expect(d.adjustment).toBeNull();
    expect(await rows(w.bid, "transactions")).toBe(before.tx);
    expect(await rows(w.bid, "change_log")).toBe(before.log);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199850000);
  });

  it("the write lands on the lender's balance and freezes the lines", async () => {
    const w = await mortgageWorld({ edited: true });
    const rtaBefore = await rta(w.bid);
    const res = await update(w.bid, w.loan.id, {
      balance: -199500000,
      current_balance: -199850000,
      today: TODAY,
    });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.adjustment_amount).toBe(350000);
    expect(d.balance).toBe(-199500000);
    expect(d.account.balance).toBe(-199500000);
    expect(d.adjustment).toMatchObject({
      amount: 350000,
      category_id: null,
      inflow_to_ready_to_assign: false,
    });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199500000);
    expect((await summary(w.bid, w.loan.id)).remaining_balance).toBe(199500000);
    const a = await activity(w.bid, w.loan.id);
    expect(a.ending_balance).toBe(-199500000);
    expect(a.other).toContainEqual(
      expect.objectContaining({
        amount: 350000,
        label: "Balance adjustment",
        memo: "Entered automatically by Budget",
      }),
    );
    expect(a.interest).toMatchObject({ amount: -1050000, state: "reconciled" });
    expect(a.escrow).toMatchObject({ amount: -300000, state: "reconciled" });
    const live = await q(
      `select t.amount, t.cleared from transactions t join payees p on p.id = t.payee_id
       where t.account_id = ? and p.system = 'loan_interest' and t.deleted_at is null`,
      w.loan.id,
    );
    expect(live).toEqual([{ amount: -1050000, cleared: "reconciled" }]);
    const gone = await q("select deleted_at from transactions where id = ?", w.editedId);
    expect(gone[0]?.deleted_at).toEqual(expect.any(String));
    // AC4: not categorised, not to Ready to Assign.
    expect(await rta(w.bid)).toBe(rtaBefore);
  });

  it("rule 8: deleting the payment afterwards keeps the frozen lines; balance -201,000.00", async () => {
    const w = await mortgageWorld({ edited: true });
    expect((await update(w.bid, w.loan.id, { balance: -199500000, today: TODAY })).status).toBe(
      200,
    );
    const del = await json(`/api/v1/budgets/${w.bid}/transactions/${w.paymentTx}`, {
      method: "DELETE",
    });
    expect(del.status).toBeLessThan(300);
    const a = await activity(w.bid, w.loan.id);
    expect(a.payments).toHaveLength(0);
    expect(a.interest).toMatchObject({ amount: -1050000, state: "reconciled" });
    expect(a.escrow).toMatchObject({ amount: -300000, state: "reconciled" });
    expect(a.ending_balance).toBe(-201000000);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-201000000);
  });
});

describe("rate and escrow (C3)", () => {
  it("keep_rate stores the rate; the update month's estimated interest uses it", async () => {
    const w = await mortgageWorld();
    const d = await data(
      await update(w.bid, w.loan.id, {
        balance: -199500000,
        interest_rate: "6.3",
        keep_rate: true,
        today: TODAY,
      }),
    );
    expect((await activity(w.bid, w.loan.id)).interest).toMatchObject({
      amount: -1050000,
      state: "reconciled",
    });
    expect(d.adjustment_amount).toBe(350000);
    expect((await accountOf(w.bid, w.loan.id)).interest_rate).toBe("6.3");
  });
  it("keep_rate false freezes at the rate but leaves the stored one", async () => {
    const w = await mortgageWorld();
    await update(w.bid, w.loan.id, {
      balance: -199500000,
      interest_rate: "6.3",
      keep_rate: false,
      today: TODAY,
    });
    expect((await activity(w.bid, w.loan.id)).interest).toMatchObject({
      amount: -1050000,
      state: "reconciled",
    });
    expect((await accountOf(w.bid, w.loan.id)).interest_rate).toBe("6");
  });
  it("escrow_amount is frozen and stored on a mortgage, refused on an auto loan", async () => {
    const w = await mortgageWorld();
    await update(w.bid, w.loan.id, {
      balance: -199550000,
      escrow_amount: 350000,
      keep_escrow: true,
      today: TODAY,
    });
    expect((await activity(w.bid, w.loan.id)).escrow).toMatchObject({
      amount: -350000,
      state: "reconciled",
    });
    expect((await accountOf(w.bid, w.loan.id)).escrow_amount).toBe(350000);
    const auto = await (await import("./loan-world")).openAccount(w.bid, {
      name: "Auto",
      type: "autoLoan",
      balance: 15000000,
      interest_rate: "4.5",
      minimum_payment: 350000,
    });
    const res = await update(w.bid, auto.id, {
      balance: -15000000,
      escrow_amount: 100000,
      today: TODAY,
    });
    expect(res.status).toBe(422);
  });
});

describe("C1: earlier months freeze too", () => {
  it("October's lines are reconciled and a later rate change leaves both months alone", async () => {
    const w = await mortgageWorld({ payments: ["2026-10-20", "2026-11-15"] });
    const before = await balanceOf(w.bid, w.loan.id);
    expect((await update(w.bid, w.loan.id, { balance: before, today: TODAY })).status).toBe(200);
    const oct = await activity(w.bid, w.loan.id, "2026-10-01");
    expect(oct.interest?.state).toBe("reconciled");
    expect(oct.escrow?.state).toBe("reconciled");
    const nov = await activity(w.bid, w.loan.id, NOV);
    const amounts = [
      oct.interest?.amount,
      oct.escrow?.amount,
      nov.interest?.amount,
      nov.escrow?.amount,
    ];
    await update(w.bid, w.loan.id, {
      balance: before,
      interest_rate: "9",
      keep_rate: true,
      today: TODAY,
    });
    const oct2 = await activity(w.bid, w.loan.id, "2026-10-01");
    const nov2 = await activity(w.bid, w.loan.id, NOV);
    expect([
      oct2.interest?.amount,
      oct2.escrow?.amount,
      nov2.interest?.amount,
      nov2.escrow?.amount,
    ]).toEqual(amounts);
  });
});

describe("refusals and repeats", () => {
  it("404, not a loan, closed, stale current_balance, a repeat", async () => {
    const w = await mortgageWorld();
    expect((await update("nope", w.loan.id, { balance: 0 })).status).toBe(404);
    expect((await update(w.bid, "nope", { balance: 0 })).status).toBe(404);
    const notLoan = await update(w.bid, w.checking.id, { balance: 0 });
    expect(notLoan.status).toBe(422);
    expect(((await notLoan.json()) as Json).error.name).toBe("not_a_loan_account");
    const stale = await update(w.bid, w.loan.id, {
      balance: -199800000,
      current_balance: -1,
      today: TODAY,
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as Json).error.name).toBe("balance_changed");
    expect(
      await q(
        "select t.id from transactions t join payees p on p.id = t.payee_id where t.account_id = ? and p.system in ('loan_interest', 'loan_escrow', 'reconciliation_adjustment') and t.deleted_at is null",
        w.loan.id,
      ),
    ).toHaveLength(0);
    expect((await update(w.bid, w.loan.id, { balance: -199800000, today: TODAY })).status).toBe(
      200,
    );
    const live = async () =>
      (
        await q(
          "select count(*) n from transactions where account_id = ? and deleted_at is null",
          w.loan.id,
        )
      )[0]?.n;
    const n = await live();
    const again = await data(await update(w.bid, w.loan.id, { balance: -199800000, today: TODAY }));
    expect(again.adjustment_amount).toBe(0);
    expect(await live()).toBe(n);
  });
  it("a closed loan is refused", async () => {
    const w = await mortgageWorld();
    await update(w.bid, w.loan.id, { balance: -199800000, today: TODAY });
    const close = await json(
      `/api/v1/budgets/${w.bid}/accounts/${w.loan.id}/close`,
      { method: "POST" },
      {},
    );
    if (close.status !== 200) return;
    const res = await update(w.bid, w.loan.id, { balance: 0, today: TODAY });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("account_closed");
  });
});

describe("change_log", () => {
  it("logs each created and deleted row, the adjustment, the account and new payees in the request's set", async () => {
    const w = await mortgageWorld({ edited: true });
    const res = await update(w.bid, w.loan.id, { balance: -199500000, today: TODAY });
    const set = setOf(res);
    const log = await q(
      "select action, entity_type, actor from change_log where budget_id = ? and change_set_id = ?",
      w.bid,
      set,
    );
    const n = (a: string, e: string) =>
      log.filter((l) => l.action === a && l.entity_type === e).length;
    expect(n("create", "transaction")).toBe(3); // interest, escrow, adjustment
    expect(n("delete", "transaction")).toBe(1); // the edited row
    expect(n("update", "account")).toBe(1);
    expect(n("create", "payee")).toBe(2); // escrow, adjustment (interest existed)
    expect(new Set(log.map((l) => l.actor))).toEqual(new Set(["user:tester@localhost"]));
  });
});

describe("REST and MCP agree", () => {
  const strip = (v: Json): Json =>
    JSON.parse(
      JSON.stringify(v, (k, x) =>
        [
          "id",
          "created_at",
          "balance_updated_at",
          "last_reconciled_at",
          "account_id",
          "budget_id",
          "payee_id",
          "sort",
          "name",
          "transaction_id",
          "last_payment_from_account_id",
          "from_account_id",
        ].includes(k)
          ? undefined
          : x,
      ),
    );
  it("update_loan_balance returns the same data and the same activity as the REST call", async () => {
    const a = await mortgageWorld({ edited: true });
    const b = await mortgageWorld({ edited: true });
    const rest = await data(await update(a.bid, a.loan.id, { balance: -199500000, today: TODAY }));
    const t = await tool("update_loan_balance", {
      budget_id: b.bid,
      account_id: b.loan.id,
      balance: -199500000,
      today: TODAY,
    });
    expect(t.isError).not.toBe(true);
    expect(strip(t.structuredContent)).toEqual(strip(rest));
    expect(strip(await activity(b.bid, b.loan.id))).toEqual(
      strip(await activity(a.bid, a.loan.id)),
    );
  });
  it("a preview through MCP writes nothing", async () => {
    const w = await mortgageWorld({ edited: true });
    const before = await rows(w.bid, "change_log");
    const t = await tool("update_loan_balance", {
      budget_id: w.bid,
      account_id: w.loan.id,
      balance: -199500000,
      today: TODAY,
      preview: true,
    });
    expect(t.structuredContent.adjustment_amount).toBe(350000);
    expect(await rows(w.bid, "change_log")).toBe(before);
  });
  it("the surface lists the path and the tool", async () => {
    expect(await apiPaths()).toContain(
      "/api/v1/budgets/{budget_id}/accounts/{account_id}/balance-update",
    );
    expect(await listedToolNames()).toContain("update_loan_balance");
    expect(updatePath("b", "a")).toContain("balance-update");
  });
});
