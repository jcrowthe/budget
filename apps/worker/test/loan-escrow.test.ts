import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import {
  activity,
  balanceOf,
  frozenRow,
  mortgageWorld,
  rows,
  TODAY,
  update,
} from "./loan-update-world";
import { D15, monthRead, NOV, openAccount, send, tool } from "./loan-world";
import { setOf, undo } from "./undo-helpers";

// EXF-1013: Add Escrow, and edit or delete a recorded escrow line (docs/loan-add-activity-design.md,
// docs/loan-manage-design.md). The mortgage world: 200,000.00 at 6%, escrow 300.00, 1,500.00 paid on 2026-11-15,
// so escrow is -300.00 estimated, interest -1,000.00 and the balance -199,800.00.
const base = (bid: string, loan: string) => `/api/v1/budgets/${bid}/accounts/${loan}/activity`;
const add = (bid: string, loan: string, body: Json) => send(base(bid, loan), "POST", body);
const patch = (bid: string, loan: string, id: string, body: Json) =>
  send(`${base(bid, loan)}/${id}`, "PATCH", body);
const del = (bid: string, loan: string, id: string) => send(`${base(bid, loan)}/${id}`, "DELETE");
const data = async (res: Response): Promise<Json> => ((await res.json()) as Json).data;
const errorOf = async (res: Response): Promise<Json> => ((await res.json()) as Json).error;

const ESCROW = { kind: "escrow", amount: 350000, month: NOV, today: D15 };
const LATER = "2026-11-20";

const liveEscrow = (bid: string) =>
  q(
    `select t.id, t.amount, t.cleared, t.date, t.memo, t.category_id, t.inflow_to_ready_to_assign, p.system, t.payee_name
     from transactions t join payees p on p.id = t.payee_id
     where t.budget_id = ? and p.system = 'loan_escrow' and t.deleted_at is null
       and substr(t.date, 1, 7) = '2026-11' order by t.created_at, t.id`,
    bid,
  );
const liveInterest = (bid: string) =>
  q(
    `select t.id from transactions t join payees p on p.id = t.payee_id
     where t.budget_id = ? and p.system = 'loan_interest' and t.deleted_at is null`,
    bid,
  );
const escrowId = async (bid: string, loan: string) => {
  const id = (await activity(bid, loan)).escrow?.transaction_id;
  if (!id) throw new Error("no escrow transaction id");
  return id;
};
const reconcile = async (w: { bid: string; loan: Json }) =>
  expect((await update(w.bid, w.loan.id, { balance: -199800000, today: TODAY })).status).toBe(200);

describe("Add Escrow", () => {
  it("records an edited escrow line and moves the balance by the difference", async () => {
    const w = await mortgageWorld();
    const bal = await balanceOf(w.bid, w.loan.id);
    const month = await monthRead(w.bid);
    const res = await add(w.bid, w.loan.id, ESCROW);
    expect(res.status).toBe(201);
    const d = await data(res);
    expect(d.kind).toBe("escrow");
    expect(d.transaction.amount).toBe(-350000);
    const a = await activity(w.bid, w.loan.id);
    expect(a.escrow).toMatchObject({
      amount: -350000,
      state: "edited",
      editable: true,
      edited_on: D15,
    });
    expect(a.escrow?.transaction_id).toBe(d.transaction.id);
    expect(a.interest).toMatchObject({ amount: -1000000, state: "estimated" });
    const live = await liveEscrow(w.bid);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      cleared: "cleared",
      payee_name: "Loan Escrow",
      category_id: null,
      inflow_to_ready_to_assign: 0,
      memo: null,
      amount: -350000,
    });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(bal - 50000);
    expect(d.balance).toBe(bal - 50000);
    expect(await monthRead(w.bid)).toEqual(month);
  });
  it("a second Add replaces the open row, in one change set", async () => {
    const w = await mortgageWorld();
    await add(w.bid, w.loan.id, ESCROW);
    const res = await add(w.bid, w.loan.id, { ...ESCROW, amount: 400000 });
    expect(res.status).toBe(201);
    const live = await liveEscrow(w.bid);
    expect(live.map((r) => r.amount)).toEqual([-400000]);
    expect((await activity(w.bid, w.loan.id)).escrow?.amount).toBe(-400000);
    const log = await q(
      "select action from change_log where budget_id = ? and change_set_id = ? order by action",
      w.bid,
      setOf(res),
    );
    expect(log.map((l) => l.action)).toEqual(["create", "delete"]);
  });
  it("an escrow above the payment's headroom moves interest into still_due", async () => {
    const w = await mortgageWorld();
    const bal = await balanceOf(w.bid, w.loan.id);
    expect((await add(w.bid, w.loan.id, { ...ESCROW, amount: 600000 })).status).toBe(201);
    const a = await activity(w.bid, w.loan.id);
    expect(a.escrow?.amount).toBe(-600000);
    expect(a.interest).toMatchObject({ amount: -900000, state: "estimated", still_due: 100000 });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(bal - 200000);
    expect(await liveInterest(w.bid)).toHaveLength(0);
  });
  it("Update Balance freezes it", async () => {
    const w = await mortgageWorld();
    await add(w.bid, w.loan.id, ESCROW);
    const bal = await balanceOf(w.bid, w.loan.id);
    expect((await update(w.bid, w.loan.id, { balance: bal, today: TODAY })).status).toBe(200);
    expect((await activity(w.bid, w.loan.id)).escrow).toMatchObject({
      amount: -350000,
      state: "reconciled",
      editable: false,
      transaction_id: null,
    });
  });
});

describe("edit and delete an escrow line", () => {
  it("an edit changes the amount", async () => {
    const w = await mortgageWorld();
    await add(w.bid, w.loan.id, ESCROW);
    const bal = await balanceOf(w.bid, w.loan.id);
    const res = await patch(w.bid, w.loan.id, await escrowId(w.bid, w.loan.id), {
      amount: 400000,
      today: LATER,
    });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.kind).toBe("escrow");
    expect(d.transaction.amount).toBe(-400000);
    expect((await activity(w.bid, w.loan.id)).escrow).toMatchObject({
      amount: -400000,
      state: "edited",
      edited_on: LATER,
    });
    expect(await liveEscrow(w.bid)).toHaveLength(1);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(bal - 50000);
    expect(d.balance).toBe(bal - 50000);
  });
  it("a delete returns the line to Estimated", async () => {
    const w = await mortgageWorld();
    const bal = await balanceOf(w.bid, w.loan.id);
    await add(w.bid, w.loan.id, ESCROW);
    const res = await del(w.bid, w.loan.id, await escrowId(w.bid, w.loan.id));
    expect(res.status).toBe(200);
    expect(await data(res)).toMatchObject({ kind: "escrow", transaction: null, balance: bal });
    expect((await activity(w.bid, w.loan.id)).escrow).toMatchObject({
      amount: -300000,
      state: "estimated",
      editable: false,
      transaction_id: null,
    });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(bal);
    expect(await liveEscrow(w.bid)).toHaveLength(0);
  });
});

describe("a reconciled escrow line is refused", () => {
  it("PATCH and DELETE are 409 reconciled_line and write nothing", async () => {
    const w = await mortgageWorld();
    await reconcile(w);
    const [rec] = await liveEscrow(w.bid);
    expect(rec?.cleared).toBe("reconciled");
    const log = await rows(w.bid, "change_log");
    for (const res of [
      await patch(w.bid, w.loan.id, rec?.id, { amount: 5000 }),
      await del(w.bid, w.loan.id, rec?.id),
    ]) {
      expect(res.status).toBe(409);
      expect((await errorOf(res)).name).toBe("reconciled_line");
    }
    expect(await rows(w.bid, "change_log")).toBe(log);
    expect((await activity(w.bid, w.loan.id)).escrow).toMatchObject({
      editable: false,
      transaction_id: null,
    });
  });
});

describe("a mixed month follows the interest rules", () => {
  async function mixed() {
    const w = await mortgageWorld();
    await reconcile(w);
    expect((await add(w.bid, w.loan.id, ESCROW)).status).toBe(201);
    return w;
  }
  it("Add writes only the difference and keeps the reconciled row", async () => {
    const w = await mortgageWorld();
    await reconcile(w);
    const [rec] = await liveEscrow(w.bid);
    expect((await add(w.bid, w.loan.id, ESCROW)).status).toBe(201);
    const live = await liveEscrow(w.bid);
    expect(live.map((r) => [r.cleared, r.amount]).sort()).toEqual([
      ["cleared", -50000],
      ["reconciled", -300000],
    ]);
    expect(live.find((r) => r.cleared === "reconciled")?.id).toBe(rec?.id);
    expect((await activity(w.bid, w.loan.id)).escrow).toMatchObject({
      amount: -350000,
      state: "edited",
    });
  });
  it("an edit replaces only the open part", async () => {
    const w = await mixed();
    const res = await patch(w.bid, w.loan.id, await escrowId(w.bid, w.loan.id), {
      amount: 400000,
      today: D15,
    });
    expect(res.status).toBe(200);
    const live = await liveEscrow(w.bid);
    expect(live.map((r) => [r.cleared, r.amount]).sort()).toEqual([
      ["cleared", -100000],
      ["reconciled", -300000],
    ]);
  });
  it("an amount at or under the reconciled part is 422 for PATCH and Add", async () => {
    const w = await mixed();
    const log = await rows(w.bid, "change_log");
    const results = [
      await patch(w.bid, w.loan.id, await escrowId(w.bid, w.loan.id), {
        amount: 300000,
        today: D15,
      }),
      await add(w.bid, w.loan.id, { ...ESCROW, amount: 300000 }),
    ];
    for (const res of results) {
      expect(res.status).toBe(422);
      expect((await errorOf(res)).detail).toContain("$300.00");
    }
    expect(await rows(w.bid, "change_log")).toBe(log);
  });
  it("a delete leaves the line reconciled", async () => {
    const w = await mixed();
    expect((await del(w.bid, w.loan.id, await escrowId(w.bid, w.loan.id))).status).toBe(200);
    expect((await activity(w.bid, w.loan.id)).escrow).toMatchObject({
      amount: -300000,
      state: "reconciled",
      editable: false,
    });
  });
});

describe("request rules", () => {
  it("a non-mortgage loan, a future month, date or memo, a closed loan", async () => {
    const w = await mortgageWorld();
    const auto = await openAccount(w.bid, {
      name: "ZZ-TEST Auto",
      type: "autoLoan",
      balance: 1000000,
      interest_rate: "4",
      minimum_payment: 1000,
    });
    const notMortgage = await add(w.bid, auto.id, ESCROW);
    expect(notMortgage.status).toBe(422);
    expect((await errorOf(notMortgage)).name).toBe("unprocessable_entity");
    const future = await add(w.bid, w.loan.id, { ...ESCROW, month: "2026-12-01" });
    expect(future.status).toBe(422);
    expect((await errorOf(future)).name).toBe("future_month");
    for (const extra of [{ date: D15 }, { memo: "ZZ-TEST" }]) {
      expect((await add(w.bid, w.loan.id, { ...ESCROW, ...extra })).status).toBe(422);
    }
    await add(w.bid, w.loan.id, ESCROW);
    const id = await escrowId(w.bid, w.loan.id);
    for (const body of [{ amount: 1, date: D15 }, { amount: 1, memo: "x" }, { today: D15 }]) {
      expect((await patch(w.bid, w.loan.id, id, body)).status).toBe(422);
    }
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(w.loan.id).run();
    const closed = await add(w.bid, w.loan.id, ESCROW);
    expect(closed.status).toBe(422);
    expect((await errorOf(closed)).name).toBe("account_closed");
  });
});

describe("undo restores each write", () => {
  it.each(["add", "add over an open row", "edit", "delete"])("%s", async (name) => {
    const w = await mortgageWorld();
    if (name !== "add") await add(w.bid, w.loan.id, ESCROW);
    const preActivity = await activity(w.bid, w.loan.id);
    const preRows = (await liveEscrow(w.bid)).map((r) => [r.id, r.amount, r.cleared]);
    const bal = await balanceOf(w.bid, w.loan.id);
    const id = preActivity.escrow?.transaction_id as string;
    const act: Record<string, () => Promise<Response>> = {
      add: () => add(w.bid, w.loan.id, ESCROW),
      "add over an open row": () => add(w.bid, w.loan.id, { ...ESCROW, amount: 420000 }),
      edit: () => patch(w.bid, w.loan.id, id, { amount: 420000, today: LATER }),
      delete: () => del(w.bid, w.loan.id, id),
    };
    const res = (await act[name]?.()) as Response;
    expect([200, 201]).toContain(res.status);
    expect(await balanceOf(w.bid, w.loan.id)).not.toBe(bal);
    expect((await undo(w.bid, setOf(res))).status).toBe(200);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(bal);
    const post = await activity(w.bid, w.loan.id);
    expect(post).toEqual(preActivity);
    expect((await liveEscrow(w.bid)).map((r) => [r.id, r.amount, r.cleared])).toEqual(preRows);
  });
});

describe("REST equals MCP", () => {
  const strip = (v: Json): Json =>
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
          "from_account_id",
          "from_account_name",
          "last_payment_from_account_id",
        ].includes(k)
          ? undefined
          : x,
      ),
    );
  it("add, edit and delete", async () => {
    const a = await mortgageWorld();
    const b = await mortgageWorld();
    const common = { budget_id: b.bid, loan_account_id: b.loan.id };
    const restAdd = await data(await add(a.bid, a.loan.id, ESCROW));
    const mcpAdd = await tool("add_loan_activity", { ...common, ...ESCROW });
    expect(mcpAdd.isError).not.toBe(true);
    expect(strip(mcpAdd.structuredContent)).toEqual(strip(restAdd));
    const restEdit = await data(
      await patch(a.bid, a.loan.id, await escrowId(a.bid, a.loan.id), {
        amount: 400000,
        today: LATER,
      }),
    );
    const mcpEdit = await tool("update_loan_activity", {
      ...common,
      transaction_id: await escrowId(b.bid, b.loan.id),
      amount: 400000,
      today: LATER,
    });
    expect(mcpEdit.isError).not.toBe(true);
    expect(strip(mcpEdit.structuredContent)).toEqual(strip(restEdit));
    const restDel = await data(await del(a.bid, a.loan.id, await escrowId(a.bid, a.loan.id)));
    const mcpDel = await tool("delete_loan_activity", {
      ...common,
      transaction_id: await escrowId(b.bid, b.loan.id),
    });
    expect(strip(mcpDel.structuredContent)).toEqual(strip(restDel));
    expect(strip(await activity(b.bid, b.loan.id))).toEqual(
      strip(await activity(a.bid, a.loan.id)),
    );
  });
  it("refusals are tool errors with the route's message", async () => {
    const w = await mortgageWorld();
    const auto = await openAccount(w.bid, {
      name: "ZZ-TEST Auto",
      type: "autoLoan",
      balance: 1000000,
      interest_rate: "4",
      minimum_payment: 1000,
    });
    const restNo = await add(w.bid, auto.id, ESCROW);
    const mcpNo = await tool("add_loan_activity", {
      budget_id: w.bid,
      loan_account_id: auto.id,
      ...ESCROW,
    });
    expect(mcpNo.isError).toBe(true);
    expect(JSON.stringify(mcpNo.content)).toContain((await errorOf(restNo)).detail);
    await reconcile(w);
    const [rec] = await liveEscrow(w.bid);
    const rest = await patch(w.bid, w.loan.id, rec?.id, { amount: 5000 });
    expect(rest.status).toBe(409);
    const r = await tool("update_loan_activity", {
      budget_id: w.bid,
      loan_account_id: w.loan.id,
      transaction_id: rec?.id,
      amount: 5000,
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain((await errorOf(rest)).detail);
  });
});

describe("a stray open escrow row", () => {
  it("is replaced by Add Escrow", async () => {
    const w = await mortgageWorld();
    await frozenRow(w.bid, w.loan.id, "loan_escrow", -320000);
    expect((await add(w.bid, w.loan.id, ESCROW)).status).toBe(201);
    expect((await liveEscrow(w.bid)).map((r) => r.amount)).toEqual([-350000]);
  });
});
