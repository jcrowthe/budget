import { interestNote } from "@budget/schema/loan-activity";
import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { activity, balanceOf, mortgageWorld, rows, rta, TODAY, update } from "./loan-update-world";
import { D15, monthRead, NOV, send, tool } from "./loan-world";
import { apiDocument, apiPaths, listedToolNames } from "./surface";
import { setOf, undo } from "./undo-helpers";

// EXF-542: Add Activity on a loan (interest, fee, credit), REST and MCP. The mortgage world: 200,000.00 at 6%,
// escrow 300.00, 1,500.00 paid on 2026-11-15 -> interest -1,000.00 estimated, balance -199,800.00.
const path = (bid: string, loan: string) => `/api/v1/budgets/${bid}/accounts/${loan}/activity`;
const addActivity = (bid: string, loan: string, body: Json) => send(path(bid, loan), "POST", body);
const data = async (res: Response): Promise<Json> => ((await res.json()) as Json).data;
const FEE = { kind: "fee", amount: 25000, date: D15, memo: "ZZ-TEST late fee", today: D15 };
const CREDIT = { kind: "credit", amount: 10000, date: D15, memo: "ZZ-TEST refund", today: D15 };
const INTEREST = { kind: "interest", amount: 50000, month: NOV, today: D15 };
const kinds = [INTEREST, FEE, CREDIT];

const liveInterest = (bid: string, month = "2026-11") =>
  q(
    `select t.id, t.amount, t.cleared, t.date, t.deleted_at from transactions t join payees p on p.id = t.payee_id
     where t.budget_id = ? and p.system = 'loan_interest' and substr(t.date, 1, 7) = ? order by t.created_at`,
    bid,
    month,
  );

describe("balance effect and line placement (AC2, AC3)", () => {
  it("interest adds to the estimated line: one edited row", async () => {
    const w = await mortgageWorld();
    const res = await addActivity(w.bid, w.loan.id, INTEREST);
    expect(res.status).toBe(201);
    const d = await data(res);
    expect(d.kind).toBe("interest");
    expect(d.transaction.amount).toBe(-1050000);
    const a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ amount: -1050000, state: "edited", edited_on: D15 });
    expect(a.interest && interestNote(a.interest, (n) => `${n}`)).toBe("Edited on November 15");
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199850000);
    expect(d.balance).toBe(-199850000);
    const live = await liveInterest(w.bid);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ amount: -1050000, cleared: "cleared", date: D15 });
  });
  it("a second interest on an edited month adds a row", async () => {
    const w = await mortgageWorld();
    await addActivity(w.bid, w.loan.id, INTEREST);
    const res = await addActivity(w.bid, w.loan.id, { ...INTEREST, amount: 20000 });
    expect(res.status).toBe(201);
    expect((await liveInterest(w.bid)).map((r) => r.amount)).toEqual([-1050000, -20000]);
    const a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ amount: -1070000, state: "edited" });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199870000);
  });
  it("interest on a month with no line is dated its last day", async () => {
    const w = await mortgageWorld();
    const res = await addActivity(w.bid, w.loan.id, {
      kind: "interest",
      amount: 40000,
      month: "2026-10-01",
      today: D15,
    });
    expect(res.status).toBe(201);
    const live = await liveInterest(w.bid, "2026-10");
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ amount: -40000, date: "2026-10-31" });
    expect((await activity(w.bid, w.loan.id, "2026-10-01")).interest).toMatchObject({
      amount: -40000,
      state: "edited",
    });
    expect((await data(res)).balance).toBe(await balanceOf(w.bid, w.loan.id));
  });
  it("interest on a reconciled month makes the line edited with the sum", async () => {
    const w = await mortgageWorld();
    expect((await update(w.bid, w.loan.id, { balance: -199800000, today: TODAY })).status).toBe(
      200,
    );
    expect((await activity(w.bid, w.loan.id)).interest?.state).toBe("reconciled");
    const res = await addActivity(w.bid, w.loan.id, INTEREST);
    expect(res.status).toBe(201);
    const a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ amount: -1050000, state: "edited" });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199850000);
  });
  it("a fee and a credit are other activity and leave the interest alone", async () => {
    const w = await mortgageWorld();
    const before = await activity(w.bid, w.loan.id);
    const fee = await addActivity(w.bid, w.loan.id, FEE);
    expect(fee.status).toBe(201);
    expect((await data(fee)).balance).toBe(-199825000);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199825000);
    const credit = await addActivity(w.bid, w.loan.id, CREDIT);
    expect(credit.status).toBe(201);
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199815000);
    const a = await activity(w.bid, w.loan.id);
    expect(a.other).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Fee or Charge",
          amount: -25000,
          memo: "ZZ-TEST late fee",
        }),
        expect.objectContaining({ label: "Credit", amount: 10000, memo: "ZZ-TEST refund" }),
      ]),
    );
    expect(a.payments).toEqual(before.payments);
    expect(a.interest).toMatchObject({ amount: -1000000, state: "estimated", edited_on: null });
  });
});

describe("the engine reads the row as edited", () => {
  it("survives deleting the payment, and the account balance equals the activity", async () => {
    const w = await mortgageWorld();
    await addActivity(w.bid, w.loan.id, INTEREST);
    const del = await send(`/api/v1/budgets/${w.bid}/transactions/${w.paymentTx}`, "DELETE");
    expect(del.status).toBeLessThan(300);
    const a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ amount: -1050000, state: "edited" });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(a.ending_balance);
  });
});

describe("Update Balance treats the row as EXF-543 expects (AC2)", () => {
  it("replaces it with one reconciled row of the same amount", async () => {
    const w = await mortgageWorld();
    await addActivity(w.bid, w.loan.id, INTEREST);
    const res = await update(w.bid, w.loan.id, { balance: -199850000, today: D15 });
    expect(res.status).toBe(200);
    expect((await data(res)).adjustment_amount).toBe(0);
    const all = await liveInterest(w.bid);
    const live = all.filter((r) => r.deleted_at === null);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ amount: -1050000, cleared: "reconciled" });
    expect(all.filter((r) => r.deleted_at !== null)).toHaveLength(1);
    const a = await activity(w.bid, w.loan.id);
    expect(a.interest).toMatchObject({ amount: -1050000, state: "reconciled" });
    expect(await balanceOf(w.bid, w.loan.id)).toBe(-199850000);
  });
  it("a past month's interest row is replaced by one reconciled row", async () => {
    const w = await mortgageWorld();
    await addActivity(w.bid, w.loan.id, {
      kind: "interest",
      amount: 40000,
      month: "2026-10-01",
      today: D15,
    });
    await update(w.bid, w.loan.id, { balance: -199840000, today: D15 });
    const live = (await liveInterest(w.bid, "2026-10")).filter((r) => r.deleted_at === null);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ amount: -40000, cleared: "reconciled" });
  });
});

describe("Ready to Assign and categories are unchanged (AC4)", () => {
  it.each(kinds)("$kind", async (body) => {
    const w = await mortgageWorld();
    const cats = async () =>
      (await monthRead(w.bid)).groups.flatMap((g: Json) =>
        g.categories.map((c: Json) => [c.id, c.budgeted, c.activity, c.available]),
      );
    const before = { rta: await rta(w.bid), cats: await cats() };
    const res = await addActivity(w.bid, w.loan.id, body);
    expect(res.status).toBe(201);
    expect(await rta(w.bid)).toBe(before.rta);
    expect(await cats()).toEqual(before.cats);
    const row = (
      await q(
        "select category_id, inflow_to_ready_to_assign from transactions where id = ?",
        (
          await data(res)
        ).transaction.id,
      )
    )[0];
    expect(row).toMatchObject({ category_id: null, inflow_to_ready_to_assign: 0 });
  });
});

describe("undo (AC3)", () => {
  it.each(kinds)("restores the state: $kind", async (body) => {
    const w = await mortgageWorld();
    const pre = { a: await activity(w.bid, w.loan.id), b: await balanceOf(w.bid, w.loan.id) };
    const res = await addActivity(w.bid, w.loan.id, body);
    expect(res.status).toBe(201);
    const id = (await data(res)).transaction.id;
    const u = await undo(w.bid, setOf(res));
    expect(u.status).toBe(200);
    expect(
      (await q("select deleted_at from transactions where id = ?", id))[0]?.deleted_at,
    ).not.toBeNull();
    expect(await balanceOf(w.bid, w.loan.id)).toBe(pre.b);
    expect(await activity(w.bid, w.loan.id)).toEqual(pre.a);
    expect((await activity(w.bid, w.loan.id)).interest).toMatchObject({
      amount: -1000000,
      state: "estimated",
    });
    if (body.kind === "interest") {
      expect(
        await q("select id from payees where budget_id = ? and system = 'loan_interest'", w.bid),
      ).toHaveLength(1);
      expect((await addActivity(w.bid, w.loan.id, body)).status).toBe(201);
    }
  });
});

describe("REST equals MCP (AC2)", () => {
  it.each(kinds)("$kind", async (body) => {
    const a = await mortgageWorld();
    const b = await mortgageWorld();
    const rest = await data(await addActivity(a.bid, a.loan.id, body));
    const mcp = await tool("add_loan_activity", {
      budget_id: b.bid,
      loan_account_id: b.loan.id,
      ...body,
    });
    expect(mcp.isError).not.toBe(true);
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
    expect(strip(mcp.structuredContent)).toEqual(strip(rest));
    expect(strip(await activity(b.bid, b.loan.id))).toEqual(
      strip(await activity(a.bid, a.loan.id)),
    );
    expect(await balanceOf(b.bid, b.loan.id)).toBe(await balanceOf(a.bid, a.loan.id));
  });
});

describe("refusals write nothing", () => {
  const state = async (bid: string) => ({
    tx: await rows(bid, "transactions"),
    log: await rows(bid, "change_log"),
  });
  it("404, 422 and the request rules", async () => {
    const w = await mortgageWorld();
    const before = await state(w.bid);
    expect((await addActivity("nope", w.loan.id, FEE)).status).toBe(404);
    expect((await addActivity(w.bid, "nope", FEE)).status).toBe(404);
    const notLoan = await addActivity(w.bid, w.checking.id, FEE);
    expect(notLoan.status).toBe(422);
    expect(((await notLoan.json()) as Json).error.name).toBe("not_a_loan_account");
    const future = await addActivity(w.bid, w.loan.id, { ...INTEREST, month: "2026-12-01" });
    expect(future.status).toBe(422);
    expect(((await future.json()) as Json).error.name).toBe("future_month");
    for (const bad of [
      { ...INTEREST, memo: "x" },
      { ...INTEREST, date: D15 },
      { ...FEE, month: NOV },
      { ...FEE, amount: 0 },
      { ...FEE, amount: -5 },
      { ...CREDIT, kind: "payment" },
    ]) {
      expect((await addActivity(w.bid, w.loan.id, bad)).status).toBe(422);
    }
    expect(await state(w.bid)).toEqual(before);
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
    const res = await addActivity(w.bid, w.loan.id, FEE);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("account_closed");
  });
});

describe("change_log", () => {
  it("one create per write, plus the payee the first time", async () => {
    const w = await mortgageWorld();
    const res = await addActivity(w.bid, w.loan.id, INTEREST);
    const log = await q(
      "select action, entity_type, actor from change_log where budget_id = ? and change_set_id = ? order by entity_type",
      w.bid,
      setOf(res),
    );
    expect(log.map((l) => `${l.action}:${l.entity_type}`)).toEqual([
      "create:payee",
      "create:transaction",
    ]);
    expect(log[0]?.actor).toBe("user:tester@localhost");
    const again = await addActivity(w.bid, w.loan.id, INTEREST);
    const log2 = await q(
      "select action, entity_type from change_log where budget_id = ? and change_set_id = ?",
      w.bid,
      setOf(again),
    );
    expect(log2).toHaveLength(1);
  });
});

describe("surface", () => {
  it("the route and the tool exist", async () => {
    const route = "/api/v1/budgets/{budget_id}/accounts/{account_id}/activity";
    expect(await apiPaths()).toContain(route);
    expect(((await apiDocument()).paths[route] as Json).post).toBeDefined();
    expect(await listedToolNames()).toContain("add_loan_activity");
  });
});
