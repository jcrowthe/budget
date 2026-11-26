import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { activity, balanceOf, mortgageWorld, rows, TODAY, update } from "./loan-update-world";
import { D15, NOV, openAccount, send, tool } from "./loan-world";
import { apiPaths, listedToolNames } from "./surface";
import { setOf, undo } from "./undo-helpers";

// Loan manage: edit or delete a recorded interest, fee or credit line (docs/loan-manage-design.md). The mortgage
// world: 200,000.00 at 6%, escrow 300.00, 1,500.00 paid on 2026-11-15 -> interest -1,000.00 estimated.
const base = (bid: string, loan: string) => `/api/v1/budgets/${bid}/accounts/${loan}/activity`;
const add = (bid: string, loan: string, body: Json) => send(base(bid, loan), "POST", body);
const patch = (bid: string, loan: string, id: string, body: Json) =>
  send(`${base(bid, loan)}/${id}`, "PATCH", body);
const del = (bid: string, loan: string, id: string) => send(`${base(bid, loan)}/${id}`, "DELETE");
const data = async (res: Response): Promise<Json> => ((await res.json()) as Json).data;
const errorOf = async (res: Response): Promise<Json> => ((await res.json()) as Json).error;

const INTEREST = { kind: "interest", amount: 50000, month: NOV, today: D15 };
const FEE = { kind: "fee", amount: 25000, date: D15, memo: "ZZ-TEST late fee", today: D15 };
const CREDIT = { kind: "credit", amount: 10000, date: D15, memo: "ZZ-TEST refund", today: D15 };
const LATER = "2026-11-20";

const liveInterest = (bid: string) =>
  q(
    `select t.id, t.amount, t.cleared, t.date, t.memo, t.category_id, t.inflow_to_ready_to_assign, p.system, t.payee_name
     from transactions t join payees p on p.id = t.payee_id
     where t.budget_id = ? and p.system = 'loan_interest' and t.deleted_at is null
       and substr(t.date, 1, 7) = '2026-11' order by t.created_at`,
    bid,
  );
const bySystem = async (bid: string, system: string, loan: string) =>
  (
    await q(
      `select t.id from transactions t join payees p on p.id = t.payee_id
       where t.budget_id = ? and p.system = ? and t.account_id = ? and t.deleted_at is null`,
      bid,
      system,
      loan,
    )
  ).map((r) => r.id as string);
const lineId = async (bid: string, loan: string) => {
  const id = (await activity(bid, loan)).interest?.transaction_id;
  if (!id) throw new Error("no interest transaction id");
  return id;
};

describe("edit an interest line", () => {
  it("replaces the line's rows with one frozen-shape row", async () => {
    const w = await mortgageWorld();
    await add(w.bid, w.loan.id, INTEREST);
    const bal = await balanceOf(w.bid, w.loan.id);
    const id = await lineId(w.bid, w.loan.id);
    const res = await patch(w.bid, w.loan.id, id, { amount: 1075000, today: LATER });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.kind).toBe("interest");
    expect(d.transaction.amount).toBe(-1075000);
    const a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({
      amount: -1075000,
      state: "edited",
      editable: true,
      edited_on: LATER,
    });
    const live = await liveInterest(w.bid);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      cleared: "cleared",
      system: "loan_interest",
      payee_name: "Loan Interest",
      category_id: null,
      inflow_to_ready_to_assign: 0,
      memo: null,
      amount: -1075000,
    });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(bal - 25000);
    expect(d.balance).toBe(bal - 25000);
  });
  it("a two-row line becomes one row with the total sent", async () => {
    const w = await mortgageWorld();
    await add(w.bid, w.loan.id, INTEREST);
    await add(w.bid, w.loan.id, { ...INTEREST, amount: 20000 });
    expect(await liveInterest(w.bid)).toHaveLength(2);
    const res = await patch(w.bid, w.loan.id, await lineId(w.bid, w.loan.id), {
      amount: 1100000,
      today: D15,
    });
    expect(res.status).toBe(200);
    const live = await liveInterest(w.bid);
    expect(live).toHaveLength(1);
    expect(live[0]?.amount).toBe(-1100000);
    expect((await activity(w.bid, w.loan.id)).interest?.amount).toBe(-1100000);
  });
});

describe("delete an interest line", () => {
  it("goes back to the estimate", async () => {
    const w = await mortgageWorld();
    const before = await balanceOf(w.bid, w.loan.id);
    await add(w.bid, w.loan.id, INTEREST);
    const res = await del(w.bid, w.loan.id, await lineId(w.bid, w.loan.id));
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d).toMatchObject({ kind: "interest", transaction: null, balance: before });
    expect((await activity(w.bid, w.loan.id)).interest).toMatchObject({
      amount: -1000000,
      state: "estimated",
      edited_on: null,
      transaction_id: null,
      editable: false,
    });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(before);
  });
});

describe("a mixed month (M3)", () => {
  async function mixed() {
    const w = await mortgageWorld();
    expect((await update(w.bid, w.loan.id, { balance: -199800000, today: TODAY })).status).toBe(
      200,
    );
    expect((await add(w.bid, w.loan.id, INTEREST)).status).toBe(201);
    return w;
  }
  it("an edit replaces only the not-reconciled part", async () => {
    const w = await mixed();
    const reconciled = (await liveInterest(w.bid)).find((r) => r.cleared === "reconciled");
    const res = await patch(w.bid, w.loan.id, await lineId(w.bid, w.loan.id), {
      amount: 1075000,
      today: D15,
    });
    expect(res.status).toBe(200);
    const live = await liveInterest(w.bid);
    expect(live.map((r) => [r.cleared, r.amount]).sort()).toEqual([
      ["cleared", -75000],
      ["reconciled", -1000000],
    ]);
    expect(live.find((r) => r.cleared === "reconciled")?.id).toBe(reconciled?.id);
    expect((await activity(w.bid, w.loan.id)).interest).toMatchObject({
      amount: -1075000,
      state: "edited",
    });
  });
  it("an amount at or under the reconciled part is 422", async () => {
    const w = await mixed();
    const before = await rows(w.bid, "change_log");
    const res = await patch(w.bid, w.loan.id, await lineId(w.bid, w.loan.id), {
      amount: 1000000,
      today: D15,
    });
    expect(res.status).toBe(422);
    expect(await rows(w.bid, "change_log")).toBe(before);
  });
  it("a delete leaves the line reconciled", async () => {
    const w = await mixed();
    expect((await del(w.bid, w.loan.id, await lineId(w.bid, w.loan.id))).status).toBe(200);
    expect((await activity(w.bid, w.loan.id)).interest).toMatchObject({
      amount: -1000000,
      state: "reconciled",
      editable: false,
    });
  });
});

describe("edit and delete a fee or credit", () => {
  it("a fee moves, changes amount and loses its memo", async () => {
    const w = await mortgageWorld();
    const before = await balanceOf(w.bid, w.loan.id);
    const created = await data(await add(w.bid, w.loan.id, FEE));
    const res = await patch(w.bid, w.loan.id, created.transaction.id, {
      amount: 40000,
      date: "2026-10-20",
      memo: null,
    });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.kind).toBe("fee");
    expect(d.transaction).toMatchObject({ amount: -40000, date: "2026-10-20", memo: null });
    // Moving the fee to October also moves the interest that carries into November, so no fixed figure here.
    expect(d.balance).toBe(await balanceOf(w.bid, w.loan.id));
    expect(d.balance).toBeLessThan(before - 40000 + 1);
    expect((await activity(w.bid, w.loan.id)).other.some((o) => o.label === "Fee or Charge")).toBe(
      false,
    );
    const oct = await activity(w.bid, w.loan.id, "2026-10-01");
    expect(oct.other).toEqual([
      expect.objectContaining({ amount: -40000, memo: null, editable: true, reconciled: false }),
    ]);
  });
  it("a credit stays positive", async () => {
    const w = await mortgageWorld();
    const created = await data(await add(w.bid, w.loan.id, CREDIT));
    const res = await patch(w.bid, w.loan.id, created.transaction.id, { amount: 15000 });
    expect(res.status).toBe(200);
    const d = await data(res);
    expect(d.kind).toBe("credit");
    expect(d.transaction.amount).toBe(15000);
  });
  it("a delete removes the row and restores the balance", async () => {
    const w = await mortgageWorld();
    const before = await balanceOf(w.bid, w.loan.id);
    const created = await data(await add(w.bid, w.loan.id, FEE));
    const res = await del(w.bid, w.loan.id, created.transaction.id);
    expect(res.status).toBe(200);
    expect(await data(res)).toMatchObject({ kind: "fee", transaction: null, balance: before });
    expect((await activity(w.bid, w.loan.id)).other).toEqual([
      expect.objectContaining({ label: "Initial Balance" }),
    ]);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(before);
  });
});

describe("refusals write nothing", () => {
  it("a reconciled line is 409 reconciled_line, an unsupported row 422", async () => {
    const w = await mortgageWorld();
    // A difference, so Update Balance writes a reconciled Balance adjustment row too.
    expect((await update(w.bid, w.loan.id, { balance: -199700000, today: TODAY })).status).toBe(
      200,
    );
    const [interestId] = await bySystem(w.bid, "loan_interest", w.loan.id);
    const [adjustId] = await bySystem(w.bid, "reconciliation_adjustment", w.loan.id);
    const [startId] = await bySystem(w.bid, "starting_balance", w.loan.id);
    expect(interestId && adjustId && startId).toBeTruthy();
    const log = await rows(w.bid, "change_log");
    for (const id of [interestId, adjustId] as string[]) {
      for (const res of [
        await patch(w.bid, w.loan.id, id, { amount: 5000 }),
        await del(w.bid, w.loan.id, id),
      ]) {
        expect(res.status).toBe(409);
        expect((await errorOf(res)).name).toBe("reconciled_line");
      }
    }
    for (const id of [startId, w.paymentTx] as string[]) {
      for (const res of [
        await patch(w.bid, w.loan.id, id, { amount: 5000 }),
        await del(w.bid, w.loan.id, id),
      ]) {
        expect(res.status).toBe(422);
        expect((await errorOf(res)).name).toBe("not_editable_activity");
      }
    }
    expect(await rows(w.bid, "change_log")).toBe(log);
  });
  it("request rules and unknown ids", async () => {
    const w = await mortgageWorld();
    await add(w.bid, w.loan.id, INTEREST);
    const fee = (await data(await add(w.bid, w.loan.id, FEE))).transaction.id as string;
    const iid = await lineId(w.bid, w.loan.id);
    const other = await openAccount(w.bid, {
      name: "Auto",
      type: "autoLoan",
      balance: 1000000,
      interest_rate: "4",
      minimum_payment: 1000,
    });
    const foreign = (await q("select id from transactions where account_id = ?", other.id))[0]
      ?.id as string;
    const log = await rows(w.bid, "change_log");
    for (const body of [
      { amount: 1, date: D15 },
      { amount: 1, memo: "x" },
    ]) {
      expect((await patch(w.bid, w.loan.id, iid, body)).status).toBe(422);
    }
    for (const body of [{}, { amount: 5, bogus: 1 }, { amount: 0 }, { amount: -5 }]) {
      expect((await patch(w.bid, w.loan.id, fee, body)).status).toBe(422);
    }
    expect((await patch(w.bid, w.loan.id, "nope", { amount: 5 })).status).toBe(404);
    expect((await del(w.bid, w.loan.id, "nope")).status).toBe(404);
    expect((await patch(w.bid, w.loan.id, foreign, { amount: 5 })).status).toBe(404);
    expect((await del(w.bid, w.loan.id, foreign)).status).toBe(404);
    expect((await patch("nope", w.loan.id, fee, { amount: 5 })).status).toBe(404);
    const notLoan = await patch(w.bid, w.checking.id, fee, { amount: 5 });
    expect(notLoan.status).toBe(422);
    expect((await errorOf(notLoan)).name).toBe("not_a_loan_account");
    expect(await rows(w.bid, "change_log")).toBe(log);
  });
  it("a closed loan is refused", async () => {
    const w = await mortgageWorld();
    const fee = (await data(await add(w.bid, w.loan.id, FEE))).transaction.id as string;
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(w.loan.id).run();
    for (const res of [
      await patch(w.bid, w.loan.id, fee, { amount: 5 }),
      await del(w.bid, w.loan.id, fee),
    ]) {
      expect(res.status).toBe(422);
      expect((await errorOf(res)).name).toBe("account_closed");
    }
  });
});

describe("Account Activity says what can be changed", () => {
  it("editable and reconciled flags", async () => {
    const w = await mortgageWorld();
    let a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ state: "estimated", transaction_id: null, editable: false });
    expect(a.escrow?.editable).toBe(false);
    const fee = await data(await add(w.bid, w.loan.id, FEE));
    await add(w.bid, w.loan.id, INTEREST);
    a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ editable: true });
    expect(a.interest?.transaction_id).toBeTruthy();
    expect(a.other.find((o) => o.transaction_id === fee.transaction.id)).toMatchObject({
      editable: true,
      reconciled: false,
    });
    expect(a.other.find((o) => o.label === "Initial Balance")).toMatchObject({
      editable: false,
    });
    await update(w.bid, w.loan.id, { balance: -199700000, today: TODAY });
    a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ state: "reconciled", editable: false });
    expect(a.interest?.transaction_id).toBeNull();
    expect(a.escrow?.editable).toBe(false);
    expect(a.other.find((o) => o.label === "Balance adjustment")).toMatchObject({
      editable: false,
      reconciled: true,
    });
  });
});

describe("undo restores each write", () => {
  it.each(["interest edit", "interest delete", "fee edit", "fee delete"])("%s", async (name) => {
    const w = await mortgageWorld();
    await add(w.bid, w.loan.id, INTEREST);
    await add(w.bid, w.loan.id, FEE);
    const pre = {
      a: await activity(w.bid, w.loan.id),
      oct: await activity(w.bid, w.loan.id, "2026-10-01"),
      b: await balanceOf(w.bid, w.loan.id),
    };
    const iid = await lineId(w.bid, w.loan.id);
    const fid = pre.a.other.find((o) => o.label === "Fee or Charge")?.transaction_id as string;
    const act: Record<string, () => Promise<Response>> = {
      "interest edit": () => patch(w.bid, w.loan.id, iid, { amount: 1075000, today: LATER }),
      "interest delete": () => del(w.bid, w.loan.id, iid),
      "fee edit": () =>
        patch(w.bid, w.loan.id, fid, { amount: 40000, date: "2026-10-20", memo: null }),
      "fee delete": () => del(w.bid, w.loan.id, fid),
    };
    const res = (await act[name]?.()) as Response;
    expect(res.status).toBe(200);
    expect(await balanceOf(w.bid, w.loan.id)).not.toBe(pre.b);
    const u = await undo(w.bid, setOf(res));
    expect(u.status).toBe(200);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(pre.b);
    expect(await activity(w.bid, w.loan.id)).toEqual(pre.a);
    expect(await activity(w.bid, w.loan.id, "2026-10-01")).toEqual(pre.oct);
  });
});

describe("change_log", () => {
  const log = (bid: string, set: string) =>
    q(
      "select action, entity_type from change_log where budget_id = ? and change_set_id = ? order by action, entity_type",
      bid,
      set,
    );
  it("an interest edit is one create and n deletes, in one change set", async () => {
    const w = await mortgageWorld();
    await add(w.bid, w.loan.id, INTEREST);
    await add(w.bid, w.loan.id, { ...INTEREST, amount: 20000 });
    const res = await patch(w.bid, w.loan.id, await lineId(w.bid, w.loan.id), {
      amount: 1100000,
      today: D15,
    });
    expect((await log(w.bid, setOf(res))).map((l) => `${l.action}:${l.entity_type}`)).toEqual([
      "create:transaction",
      "delete:transaction",
      "delete:transaction",
    ]);
  });
  it("a fee edit is one update, a delete one delete per row", async () => {
    const w = await mortgageWorld();
    const f = (await data(await add(w.bid, w.loan.id, FEE))).transaction.id as string;
    const edit = await patch(w.bid, w.loan.id, f, { amount: 1000 });
    expect((await log(w.bid, setOf(edit))).map((l) => `${l.action}:${l.entity_type}`)).toEqual([
      "update:transaction",
    ]);
    const gone = await del(w.bid, w.loan.id, f);
    expect((await log(w.bid, setOf(gone))).map((l) => `${l.action}:${l.entity_type}`)).toEqual([
      "delete:transaction",
    ]);
    await add(w.bid, w.loan.id, INTEREST);
    await add(w.bid, w.loan.id, { ...INTEREST, amount: 20000 });
    const d = await del(w.bid, w.loan.id, await lineId(w.bid, w.loan.id));
    expect((await log(w.bid, setOf(d))).map((l) => `${l.action}:${l.entity_type}`)).toEqual([
      "delete:transaction",
      "delete:transaction",
    ]);
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
  it("edit and delete", async () => {
    const a = await mortgageWorld();
    const b = await mortgageWorld();
    const ids = [] as string[];
    for (const w of [a, b]) {
      await add(w.bid, w.loan.id, INTEREST);
      const f = await data(await add(w.bid, w.loan.id, FEE));
      ids.push(await lineId(w.bid, w.loan.id), f.transaction.id);
    }
    const [ai, af, bi, bf] = ids as [string, string, string, string];
    const common = { budget_id: b.bid, loan_account_id: b.loan.id };
    const restEdit = await data(await patch(a.bid, a.loan.id, ai, { amount: 1075000, today: D15 }));
    const mcpEdit = await tool("update_loan_activity", {
      ...common,
      transaction_id: bi,
      amount: 1075000,
      today: D15,
    });
    expect(mcpEdit.isError).not.toBe(true);
    expect(strip(mcpEdit.structuredContent)).toEqual(strip(restEdit));
    const restFee = await data(await patch(a.bid, a.loan.id, af, { amount: 3000, memo: null }));
    const mcpFee = await tool("update_loan_activity", {
      ...common,
      transaction_id: bf,
      amount: 3000,
      memo: null,
    });
    expect(strip(mcpFee.structuredContent)).toEqual(strip(restFee));
    const restDel = await data(await del(a.bid, a.loan.id, af));
    const mcpDel = await tool("delete_loan_activity", { ...common, transaction_id: bf });
    expect(strip(mcpDel.structuredContent)).toEqual(strip(restDel));
    const ni = await lineId(a.bid, a.loan.id);
    const mi = await lineId(b.bid, b.loan.id);
    const restDelI = await data(await del(a.bid, a.loan.id, ni));
    const mcpDelI = await tool("delete_loan_activity", { ...common, transaction_id: mi });
    expect(strip(mcpDelI.structuredContent)).toEqual(strip(restDelI));
    const norm = strip;
    expect(norm(await activity(b.bid, b.loan.id))).toEqual(norm(await activity(a.bid, a.loan.id)));
  });
  it("a refusal is a tool error with the route's message", async () => {
    const w = await mortgageWorld();
    await update(w.bid, w.loan.id, { balance: -199800000, today: TODAY });
    const [rid] = await bySystem(w.bid, "loan_interest", w.loan.id);
    const rest = await patch(w.bid, w.loan.id, rid as string, { amount: 5000 });
    expect(rest.status).toBe(409);
    const err = await errorOf(rest);
    const r = await tool("update_loan_activity", {
      budget_id: w.bid,
      loan_account_id: w.loan.id,
      transaction_id: rid,
      amount: 5000,
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain(err.detail);
    const d = await tool("delete_loan_activity", {
      budget_id: w.bid,
      loan_account_id: w.loan.id,
      transaction_id: rid,
    });
    expect(d.isError).toBe(true);
  });
});

describe("surface", () => {
  it("the route and the tools exist", async () => {
    expect(await apiPaths()).toContain(
      "/api/v1/budgets/{budget_id}/accounts/{account_id}/activity/{transaction_id}",
    );
    const names = await listedToolNames();
    expect(names).toContain("update_loan_activity");
    expect(names).toContain("delete_loan_activity");
  });
});
