import { PAYMENT_OTHER_CLOSED_TEXT } from "@budget/schema/loan-manage";
import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import {
  accountOf,
  activity,
  balanceOf,
  mortgageWorld,
  rows,
  TODAY,
  update,
} from "./loan-update-world";
import { D15, NOV, send, tool } from "./loan-world";
import { setOf, undo } from "./undo-helpers";

// Loan payments: edit or delete a payment from the loan's Account Activity (docs/loan-manage-design.md). The
// mortgage world: 1,500.00 paid from Checking on 2026-11-15; both sides of the transfer change together.
const OCT = "2026-10-01";
const base = (bid: string, loan: string) => `/api/v1/budgets/${bid}/accounts/${loan}/activity`;
const patch = (bid: string, loan: string, id: string, body: Json) =>
  send(`${base(bid, loan)}/${id}`, "PATCH", body);
const del = (bid: string, loan: string, id: string) => send(`${base(bid, loan)}/${id}`, "DELETE");
const data = async (res: Response): Promise<Json> => ((await res.json()) as Json).data;
const errorOf = async (res: Response): Promise<Json> => ((await res.json()) as Json).error;

const side = async (id: string) =>
  (
    await q(
      `select id, account_id, amount, date, memo, deleted_at, cleared, category_id, transfer_account_id, transfer_transaction_id
       from transactions where id = ?`,
      id,
    )
  )[0] as Json;
async function paymentWorld() {
  const w = await mortgageWorld();
  const cashId = (
    await q("select id from transactions where transfer_transaction_id = ?", w.paymentTx)
  )[0]?.id as string;
  return { ...w, cashId, loanId: w.loan.id as string, checkId: w.checking.id as string };
}
const snapshot = async (w: Awaited<ReturnType<typeof paymentWorld>>) => ({
  loanRow: await side(w.paymentTx),
  cashRow: await side(w.cashId),
  loanBal: await balanceOf(w.bid, w.loanId),
  checkBal: await balanceOf(w.bid, w.checkId),
  nov: await activity(w.bid, w.loanId, NOV),
  oct: await activity(w.bid, w.loanId, OCT),
});

describe("edit a payment", () => {
  it("amount: both sides, the loan balance and the cash balance", async () => {
    const w = await paymentWorld();
    const before = await snapshot(w);
    const res = await patch(w.bid, w.loanId, w.paymentTx, { amount: 1600000 });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.kind).toBe("payment");
    expect(d.transaction.amount).toBe(1600000);
    expect(d.from_transaction.amount).toBe(-1600000);
    const l = await side(w.paymentTx);
    const c = await side(w.cashId);
    expect(l).toMatchObject({
      amount: 1600000,
      deleted_at: null,
      transfer_transaction_id: w.cashId,
    });
    expect(c).toMatchObject({
      amount: -1600000,
      deleted_at: null,
      transfer_transaction_id: w.paymentTx,
      date: l.date,
      memo: l.memo,
      category_id: before.cashRow.category_id,
    });
    const bal = await balanceOf(w.bid, w.loanId);
    expect(bal).toBeGreaterThan(before.loanBal);
    expect(d.balance).toBe(bal);
    expect(await balanceOf(w.bid, w.checkId)).toBe(before.checkBal - 100000);
  });
  it("date across months", async () => {
    const w = await paymentWorld();
    const before = await snapshot(w);
    const res = await patch(w.bid, w.loanId, w.paymentTx, { date: "2026-10-20" });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect((await side(w.paymentTx)).date).toBe("2026-10-20");
    expect((await side(w.cashId)).date).toBe("2026-10-20");
    const nov = await activity(w.bid, w.loanId, NOV);
    expect(nov.payments).toHaveLength(0);
    expect(nov.interest).not.toEqual(before.nov.interest);
    expect((await activity(w.bid, w.loanId, OCT)).payments).toHaveLength(1);
    expect(d.balance).toBe(await balanceOf(w.bid, w.loanId));
  });
  it("memo, then cleared", async () => {
    const w = await paymentWorld();
    const before = await snapshot(w);
    const res = await patch(w.bid, w.loanId, w.paymentTx, { memo: "ZZ-TEST memo" });
    expect(res.status).toBe(200);
    expect((await side(w.paymentTx)).memo).toBe("ZZ-TEST memo");
    expect((await side(w.cashId)).memo).toBe("ZZ-TEST memo");
    expect((await data(res)).balance).toBe(before.loanBal);
    const res2 = await patch(w.bid, w.loanId, w.paymentTx, { memo: null });
    expect(res2.status).toBe(200);
    expect((await side(w.paymentTx)).memo).toBeNull();
    expect((await side(w.cashId)).memo).toBeNull();
    expect(await balanceOf(w.bid, w.loanId)).toBe(before.loanBal);
    expect(await balanceOf(w.bid, w.checkId)).toBe(before.checkBal);
  });
  it("the cash account's register shows the edit", async () => {
    const w = await paymentWorld();
    await patch(w.bid, w.loanId, w.paymentTx, {
      amount: 1600000,
      date: "2026-10-20",
      memo: "ZZ-TEST memo",
    });
    const one = await data(await json(`/api/v1/budgets/${w.bid}/transactions/${w.cashId}`));
    expect(one.transaction).toMatchObject({
      amount: -1600000,
      date: "2026-10-20",
      memo: "ZZ-TEST memo",
      transfer_account_id: w.loanId,
    });
    const list = await data(
      await json(`/api/v1/budgets/${w.bid}/accounts/${w.checkId}/transactions`),
    );
    const found = (list.transactions as Json[]).find((t) => t.id === w.cashId);
    expect(found).toMatchObject({ amount: -1600000, date: "2026-10-20", memo: "ZZ-TEST memo" });
  });
});

describe("delete a payment", () => {
  it("removes both sides", async () => {
    const w = await paymentWorld();
    const before = await snapshot(w);
    const res = await del(w.bid, w.loanId, w.paymentTx);
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d).toMatchObject({ kind: "payment", transaction: null, from_transaction: null });
    expect((await side(w.paymentTx)).deleted_at).not.toBeNull();
    expect((await side(w.cashId)).deleted_at).not.toBeNull();
    expect((await activity(w.bid, w.loanId, NOV)).payments).toHaveLength(0);
    expect(await balanceOf(w.bid, w.loanId)).toBe(-200000000);
    expect(await balanceOf(w.bid, w.checkId)).toBe(before.checkBal + 1500000);
    expect(d.balance).toBe(await balanceOf(w.bid, w.loanId));
  });
});

describe("undo restores both sides", () => {
  const edits: [string, (w: Awaited<ReturnType<typeof paymentWorld>>) => Promise<Response>][] = [
    ["amount", (w) => patch(w.bid, w.loanId, w.paymentTx, { amount: 1600000 })],
    ["date", (w) => patch(w.bid, w.loanId, w.paymentTx, { date: "2026-10-20" })],
    ["memo", (w) => patch(w.bid, w.loanId, w.paymentTx, { memo: "ZZ-TEST memo" })],
    ["delete", (w) => del(w.bid, w.loanId, w.paymentTx)],
  ];
  it.each(edits)("%s", async (_n, run) => {
    const w = await paymentWorld();
    const before = await snapshot(w);
    const res = await run(w);
    expect(res.status).toBe(200);
    const u = await undo(w.bid, setOf(res));
    expect(u.status).toBe(200);
    const after = await snapshot(w);
    expect(after.loanRow).toMatchObject({
      amount: before.loanRow.amount,
      date: before.loanRow.date,
      memo: before.loanRow.memo,
      deleted_at: null,
      transfer_transaction_id: w.cashId,
    });
    expect(after.cashRow).toMatchObject({
      amount: before.cashRow.amount,
      date: before.cashRow.date,
      memo: before.cashRow.memo,
      deleted_at: null,
      transfer_transaction_id: w.paymentTx,
    });
    expect(after.loanBal).toBe(before.loanBal);
    expect(after.checkBal).toBe(before.checkBal);
    expect(after.nov).toEqual(before.nov);
    expect(after.oct).toEqual(before.oct);
  });
});

describe("change_log", () => {
  const logs = (setId: string) =>
    q(
      "select action, entity_id from change_log where change_set_id = ? order by action, entity_id",
      setId,
    );
  it("an edit is two update rows in one change set, a delete two delete rows", async () => {
    const w = await paymentWorld();
    const e = await patch(w.bid, w.loanId, w.paymentTx, { amount: 1600000 });
    const el = await logs(setOf(e));
    expect(el.map((r) => r.action)).toEqual(["update", "update"]);
    expect(new Set(el.map((r) => r.entity_id))).toEqual(new Set([w.paymentTx, w.cashId]));
    const d = await del(w.bid, w.loanId, w.paymentTx);
    const dl = await logs(setOf(d));
    expect(dl.map((r) => r.action)).toEqual(["delete", "delete"]);
    expect(new Set(dl.map((r) => r.entity_id))).toEqual(new Set([w.paymentTx, w.cashId]));
  });
});

describe("a reconciled side refuses", () => {
  it.each([
    ["cash", "cash"],
    ["loan", "loan"],
  ])("%s side", async (_n, which) => {
    const w = await paymentWorld();
    const rec = which === "cash" ? w.cashId : w.paymentTx;
    await q("update transactions set cleared = 'reconciled' where id = ?", rec);
    const name = ((await accountOf(w.bid, which === "cash" ? w.checkId : w.loanId)) as Json).name;
    const log = await rows(w.bid, "change_log");
    const l0 = await side(w.paymentTx);
    const c0 = await side(w.cashId);
    for (const res of [
      await patch(w.bid, w.loanId, w.paymentTx, { amount: 1600000 }),
      await patch(w.bid, w.loanId, w.paymentTx, { memo: "ZZ-TEST memo" }),
      await del(w.bid, w.loanId, w.paymentTx),
    ]) {
      expect(res.status).toBe(409);
      const err = await errorOf(res);
      expect(err.name).toBe("reconciled_line");
      expect(err.detail).toBe(`This payment is reconciled in ${name} and can't be changed`);
    }
    expect(await rows(w.bid, "change_log")).toBe(log);
    expect(await side(w.paymentTx)).toEqual(l0);
    expect(await side(w.cashId)).toEqual(c0);
    const p = (await activity(w.bid, w.loanId)).payments[0];
    expect(p).toMatchObject({ editable: false, reconciled: true });
  });
});

describe("other refusals", () => {
  it("a closed cash account", async () => {
    const w = await paymentWorld();
    await q("update accounts set closed = 1 where id = ?", w.checkId);
    for (const res of [
      await patch(w.bid, w.loanId, w.paymentTx, { amount: 1600000 }),
      await del(w.bid, w.loanId, w.paymentTx),
    ]) {
      expect(res.status).toBe(422);
      const err = await errorOf(res);
      expect(err.name).toBe("account_closed");
      expect(err.detail).toBe(PAYMENT_OTHER_CLOSED_TEXT);
    }
    expect((await activity(w.bid, w.loanId)).payments[0]).toMatchObject({
      editable: false,
      reconciled: false,
    });
  });
  it("no other side, today, empty body, unknown id", async () => {
    const w = await paymentWorld();
    const id = crypto.randomUUID();
    await q(
      `insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign, transfer_account_id)
       values (?, ?, ?, ?, 1000, 'cleared', 1, ?, ?, 0, ?)`,
      id,
      w.bid,
      w.loanId,
      D15,
      new Date().toISOString(),
      new Date().toISOString(),
      w.checkId,
    );
    for (const res of [
      await patch(w.bid, w.loanId, id, { amount: 2000 }),
      await del(w.bid, w.loanId, id),
    ]) {
      expect(res.status).toBe(422);
      expect((await errorOf(res)).name).toBe("not_editable_activity");
    }
    const t = await patch(w.bid, w.loanId, w.paymentTx, { amount: 1600000, today: D15 });
    expect(t.status).toBe(422);
    expect((await errorOf(t)).name).toBe("unprocessable_entity");
    expect((await patch(w.bid, w.loanId, w.paymentTx, {})).status).toBe(422);
    expect((await patch(w.bid, w.loanId, crypto.randomUUID(), { amount: 1000 })).status).toBe(404);
    expect((await del(w.bid, w.loanId, crypto.randomUUID())).status).toBe(404);
  });
});

describe("activity flags", () => {
  it("a fresh payment is editable and not reconciled", async () => {
    const w = await paymentWorld();
    expect((await activity(w.bid, w.loanId)).payments[0]).toMatchObject({
      editable: true,
      reconciled: false,
    });
  });
});

describe("REST equals MCP", () => {
  const strip = (v: unknown): unknown =>
    JSON.parse(
      JSON.stringify(v, (k, x) =>
        [
          "id",
          "account_id",
          "budget_id",
          "payee_id",
          "created_at",
          "updated_at",
          "transaction_id",
          "transfer_transaction_id",
          "transfer_account_id",
          "category_id",
          "from_account_id",
          "from_account_name",
          "last_payment_from_account_id",
          "account_name",
          "payee_name",
        ].includes(k)
          ? undefined
          : x,
      ),
    );
  it("edit and delete", async () => {
    const a = await paymentWorld();
    const b = await paymentWorld();
    const common = { budget_id: b.bid, loan_account_id: b.loanId };
    const restEdit = await data(
      await patch(a.bid, a.loanId, a.paymentTx, { amount: 1600000, memo: "ZZ-TEST memo" }),
    );
    const mcpEdit = await tool("update_loan_activity", {
      ...common,
      transaction_id: b.paymentTx,
      amount: 1600000,
      memo: "ZZ-TEST memo",
    });
    expect(mcpEdit.isError).not.toBe(true);
    expect(mcpEdit.structuredContent.kind).toBe("payment");
    expect(strip(mcpEdit.structuredContent)).toEqual(strip(restEdit));
    const restDel = await data(await del(a.bid, a.loanId, a.paymentTx));
    const mcpDel = await tool("delete_loan_activity", { ...common, transaction_id: b.paymentTx });
    expect(strip(mcpDel.structuredContent)).toEqual(strip(restDel));
  });
  it("a reconciled refusal is a tool error with the route's message", async () => {
    const w = await paymentWorld();
    await q("update transactions set cleared = 'reconciled' where id = ?", w.cashId);
    const rest = await errorOf(await patch(w.bid, w.loanId, w.paymentTx, { amount: 1600000 }));
    const r = await tool("update_loan_activity", {
      budget_id: w.bid,
      loan_account_id: w.loanId,
      transaction_id: w.paymentTx,
      amount: 1600000,
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain(rest.detail);
  });
});

describe("a frozen month", () => {
  it("a payment can be edited after Update Balance; the frozen interest stays", async () => {
    const w = await paymentWorld();
    expect((await update(w.bid, w.loanId, { balance: -199800000, today: TODAY })).status).toBe(200);
    const frozen = async () =>
      q(
        `select t.amount, t.cleared from transactions t join payees p on p.id = t.payee_id
         where t.account_id = ? and p.system = 'loan_interest' and t.deleted_at is null`,
        w.loanId,
      );
    const f0 = await frozen();
    const res = await patch(w.bid, w.loanId, w.paymentTx, { amount: 1600000 });
    expect(res.status).toBe(200);
    expect(await frozen()).toEqual(f0);
    const a = await activity(w.bid, w.loanId);
    expect(a.interest?.state).toBe("reconciled");
    expect((await data(res)).balance).toBe(await balanceOf(w.bid, w.loanId));
  });
});
