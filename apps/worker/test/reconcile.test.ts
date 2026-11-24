import { describe, expect, it } from "vitest";
import { account, category, get, plan, q, tool, tx } from "./bulk-helpers";
import { json } from "./helpers";
import { actor, type Json, MONTH, reconcile, seedWorkedExample, send } from "./reconcile-helpers";
import { apiPaths, listedToolNames } from "./surface";

const acct = async (b: string, id: string) =>
  ((await (await json(`/api/v1/budgets/${b}/accounts/${id}`)).json()) as Json).data.account as Json;
const rta = async (b: string) =>
  ((await (await json(`/api/v1/budgets/${b}/months/${MONTH}`)).json()) as Json).data
    .ready_to_assign as number;
const rows = (aid: string) =>
  q(
    "select id, amount, cleared, category_id, inflow_to_ready_to_assign, memo, payee_name from transactions where account_id = ? and deleted_at is null",
    aid,
  );
const counts = async (b: string) => ({
  tx: (await q("select count(*) n from transactions where budget_id = ?", b))[0]?.n,
  log: (await q("select count(*) n from change_log where budget_id = ?", b))[0]?.n,
});
const body = async (res: Response) => (await res.json()) as Json;

describe("reconcile: refusals (case 11)", () => {
  it("409 reconcile_difference with the difference and writes nothing", async () => {
    const w = await seedWorkedExample();
    const before = await counts(w.b);
    const res = await reconcile(w.b, w.checking, { statement_balance: 655500 });
    expect(res.status).toBe(409);
    const e = (await body(res)).error;
    expect(e).toMatchObject({
      name: "reconcile_difference",
      difference: -100000,
      cleared_balance: 755500,
    });
    expect(e.detail).toContain("-100000");
    expect(await counts(w.b)).toEqual(before);
    expect((await acct(w.b, w.checking)).last_reconciled_at).toBeNull();
  });

  it("a stale cleared_balance is 409 reconcile_changed; unknown 404", async () => {
    const w = await seedWorkedExample();
    const res = await reconcile(w.b, w.checking, { statement_balance: 755500, cleared_balance: 1 });
    expect(res.status).toBe(409);
    expect((await body(res)).error).toMatchObject({
      name: "reconcile_changed",
      difference: 0,
      cleared_balance: 755500,
    });
    expect((await reconcile(w.b, crypto.randomUUID(), { statement_balance: 0 })).status).toBe(404);
  });
});

describe("reconcile: the worked example to the milliunit (case 12)", () => {
  it("walks both reconciles", async () => {
    const w = await seedWorkedExample();
    expect((await reconcile(w.b, w.checking, { statement_balance: 655500 })).status).toBe(409);
    expect(
      (
        await send(`/api/v1/budgets/${w.b}/transactions/${w.transfer}`, "PATCH", {
          cleared: "cleared",
        })
      ).status,
    ).toBe(200);
    const first = await reconcile(w.b, w.checking, {
      statement_balance: 655500,
      cleared_balance: 655500,
    });
    expect(first.status).toBe(200);
    const d1 = (await body(first)).data;
    expect(d1.reconciled_count).toBe(7);
    expect(d1.adjustment).toBeNull();
    expect(d1.account.last_reconciled_at).toEqual(expect.any(String));
    expect((await rows(w.checking)).filter((r) => r.cleared === "reconciled")).toHaveLength(7);
    const logged = await q(
      "select actor, before_json, after_json from change_log where entity_type = 'transaction' and budget_id = ? and json_extract(after_json, '$.cleared') = 'reconciled' and action = 'update'",
      w.b,
    );
    expect(logged).toHaveLength(7);
    for (const l of logged) {
      expect(l.actor).toBe(actor);
      expect(JSON.parse(l.before_json).cleared).toBe("cleared");
    }
    const acctLog = await q(
      "select actor, after_json from change_log where entity_type = 'account' and entity_id = ? and action = 'update' order by rowid desc limit 1",
      w.checking,
    );
    expect(JSON.parse(acctLog[0]?.after_json).last_reconciled_at).toBe(
      d1.account.last_reconciled_at,
    );
    expect(acctLog[0]?.actor).toBe(actor);

    const T = `/api/v1/budgets/${w.b}/transactions/${w.refund}`;
    const refused = await send(T, "PATCH", { amount: 35000 });
    expect(refused.status).toBe(409);
    expect((await body(refused)).error.name).toBe("transaction_reconciled");
    expect((await send(T, "PATCH", { amount: 35000, confirm_reconciled: true })).status).toBe(200);
    expect((await acct(w.b, w.checking)).cleared_balance).toBe(660500);
    expect((await get(w.b, w.refund)).cleared).toBe("reconciled");

    const rtaBefore = await rta(w.b);
    const second = await reconcile(w.b, w.checking, {
      statement_balance: 655500,
      create_adjustment: true,
      cleared_balance: 660500,
      today: "2026-11-12",
    });
    expect(second.status).toBe(200);
    const d2 = (await body(second)).data;
    expect(d2.reconciled_count).toBe(0);
    expect(d2.adjustment).toMatchObject({
      amount: -5000,
      cleared: "reconciled",
      payee_name: "Reconciliation Balance Adjustment",
      memo: "Entered automatically by Budget",
      category_id: null,
      inflow_to_ready_to_assign: true,
      approved: true,
      date: "2026-11-12",
    });
    const a = await acct(w.b, w.checking);
    expect(a.cleared_balance).toBe(655500);
    expect(a.balance).toBe(495500);
    expect(d2.account).toMatchObject({ cleared_balance: 655500, balance: 495500 });
    expect(await rta(w.b)).toBe(rtaBefore - 5000);
    const adj = (await rows(w.checking)).find((r) => r.amount === -5000);
    expect(adj?.cleared).toBe("reconciled");
    const created = await q(
      "select actor from change_log where entity_type = 'transaction' and action = 'create' and entity_id = ?",
      d2.adjustment.id,
    );
    expect(created).toEqual([{ actor }]);
    const payee = await q(
      "select name from payees where budget_id = ? and system = 'reconciliation_adjustment'",
      w.b,
    );
    expect(payee).toEqual([{ name: "Reconciliation Balance Adjustment" }]);
  });

  it("Yes with only a Starting Balance sets last_reconciled_at; a second reconcile counts only new rows; the key replays", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    const r1 = await body(await reconcile(b, a, { statement_balance: 0 }));
    expect(r1.data.reconciled_count).toBe(1); // the zero Starting Balance row
    expect(r1.data.account.last_reconciled_at).toEqual(expect.any(String));
    await tx(b, {
      account_id: a,
      date: "2026-11-10",
      amount: -1000,
      payee_name: "ZZ X",
      cleared: "cleared",
    });
    const r2 = await body(await reconcile(b, a, { statement_balance: -1000 }));
    expect(r2.data.reconciled_count).toBe(1);
    const r3 = await body(await reconcile(b, a, { statement_balance: -1000 }));
    expect(r3.data.reconciled_count).toBe(0);
    const key = crypto.randomUUID();
    const post = () =>
      json(
        `/api/v1/budgets/${b}/accounts/${a}/reconcile`,
        { method: "POST", headers: { "Idempotency-Key": key } },
        { statement_balance: -1000 },
      );
    const x = await body(await post());
    const y = await body(await post());
    expect(y).toEqual(x);
  });
});

describe("reconcile: PATCH rules on reconciled rows (case 13)", () => {
  it("saves memo, payee, category and flag; asks for amount, date, account, cleared, transfer account", async () => {
    const w = await seedWorkedExample();
    expect(
      (
        await send(`/api/v1/budgets/${w.b}/transactions/${w.transfer}`, "PATCH", {
          cleared: "cleared",
        })
      ).status,
    ).toBe(200);
    expect((await reconcile(w.b, w.checking, { statement_balance: 655500 })).status).toBe(200);
    const T = `/api/v1/budgets/${w.b}/transactions/${w.fuel}`;
    const before = await counts(w.b);
    for (const patch of [
      { amount: -1 },
      { date: "2026-11-11" },
      { account_id: w.savings },
      { cleared: "uncleared" },
    ]) {
      const res = await send(T, "PATCH", patch);
      expect(res.status, JSON.stringify(patch)).toBe(409);
    }
    expect(await counts(w.b)).toEqual(before);
    for (const patch of [
      { memo: "m" },
      { payee_name: "ZZ New" },
      { category_id: null, inflow_to_ready_to_assign: true },
      { flag_color: "red" },
    ]) {
      expect((await send(T, "PATCH", patch)).status, JSON.stringify(patch)).toBe(200);
    }
    expect((await get(w.b, w.fuel)).cleared).toBe("reconciled");
    expect((await send(T, "PATCH", { amount: -21000, confirm_reconciled: true })).status).toBe(200);
    expect((await get(w.b, w.fuel)).cleared).toBe("reconciled");
    expect((await send(T, "PATCH", { cleared: "cleared", confirm_reconciled: true })).status).toBe(
      200,
    );
    expect((await get(w.b, w.fuel)).cleared).toBe("cleared");
  });
});

describe("reconcile: cards and tracking accounts (case 16)", () => {
  it("a card's adjustment goes to Ready to Assign and leaves the payment category alone", async () => {
    const b = await plan();
    const card = await account(b, "creditCard", 50000);
    const cardRow = await acct(b, card);
    expect(cardRow.cleared_balance).toBe(-50000);
    const month = async () =>
      ((await (await json(`/api/v1/budgets/${b}/months/${MONTH}`)).json()) as Json).data;
    const pay = (m: Json) =>
      m.groups.flatMap((g: Json) => g.categories).find((c: Json) => c.name === cardRow.name);
    const m0 = await month();
    const res = await reconcile(b, card, {
      statement_balance: -55000,
      create_adjustment: true,
      today: "2026-11-15",
    });
    expect(res.status).toBe(200);
    const d = (await body(res)).data;
    expect(d.adjustment).toMatchObject({
      amount: -5000,
      inflow_to_ready_to_assign: true,
      category_id: null,
      cleared: "reconciled",
    });
    const m1 = await month();
    expect(m1.ready_to_assign).toBe(m0.ready_to_assign - 5000);
    expect(pay(m1).available).toBe(pay(m0).available);
    expect((await acct(b, card)).cleared_balance).toBe(-55000);
  });

  it("a tracking account's adjustment has no category and Ready to Assign does not move", async () => {
    const b = await plan();
    const asset = await account(b, "otherAsset", 100000);
    const before = await rta(b);
    const res = await reconcile(b, asset, { statement_balance: 120000, create_adjustment: true });
    expect(res.status).toBe(200);
    const adj = (await body(res)).data.adjustment;
    expect(adj).toMatchObject({
      amount: 20000,
      category_id: null,
      inflow_to_ready_to_assign: false,
    });
    expect(await rta(b)).toBe(before);
    await category(b);
  });
});

describe("reconcile: surface and MCP (case 17)", () => {
  it("lists the path and the tool", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining(["/api/v1/budgets/{budget_id}/accounts/{account_id}/reconcile"]),
    );
    expect(await listedToolNames()).toContain("reconcile_account");
  });

  it("reconcile_account returns the data; a difference is a tool error with the milliunits", async () => {
    const w = await seedWorkedExample();
    const err = await tool("reconcile_account", {
      budget_id: w.b,
      account_id: w.checking,
      statement_balance: 655500,
    });
    expect(err.result.isError).toBe(true);
    expect(JSON.stringify(err.result)).toContain("-100000");
    const ok = await tool("reconcile_account", {
      budget_id: w.b,
      account_id: w.checking,
      statement_balance: 655500,
      create_adjustment: true,
      today: "2026-11-12",
    });
    const sc = ok.result.structuredContent;
    expect(sc.reconciled_count).toBe(6);
    expect(sc.adjustment.amount).toBe(-100000);
    expect(typeof sc.account.last_reconciled_at).toBe("string");
    const got = await tool("get_account", { budget_id: w.b, account_id: w.checking });
    expect(got.result.structuredContent.account.last_reconciled_at).toBe(
      sc.account.last_reconciled_at,
    );
    const logRows = await q(
      "select actor from change_log where entity_type = 'account' and entity_id = ? and action = 'update'",
      w.checking,
    );
    expect(logRows.at(-1)?.actor).toMatch(/^mcp:/);
  });
});

describe("reconcile: a closed account reconciles like an open one (EXF-721, case 16)", () => {
  const close = async (b: string, id: string) =>
    expect((await send(`/api/v1/budgets/${b}/accounts/${id}/close`, "POST", {})).status).toBe(200);

  it("returns 200 without a difference and without an adjustment", async () => {
    const w = await seedWorkedExample();
    const empty = await account(w.b, "checking", 0);
    await close(w.b, empty);
    const res = await reconcile(w.b, empty, { statement_balance: 0 });
    expect(res.status).toBe(200);
    const d = (await body(res)).data;
    expect(d.adjustment).toBeNull();
    expect(d.account.last_reconciled_at).toEqual(expect.any(String));
    expect(d.account.closed).toBe(true);
  });

  it("returns 200 with an adjustment, and the adjustment row exists", async () => {
    const w = await seedWorkedExample();
    const empty = await account(w.b, "checking", 0);
    await close(w.b, empty);
    const refused = await reconcile(w.b, empty, { statement_balance: 5000 });
    expect(refused.status).toBe(409);
    const res = await reconcile(w.b, empty, { statement_balance: 5000, create_adjustment: true });
    expect(res.status).toBe(200);
    const d = (await body(res)).data;
    expect(d.adjustment).toMatchObject({ amount: 5000 });
    const adj = (await rows(empty)).filter(
      (r) => r.payee_name === "Reconciliation Balance Adjustment",
    );
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ amount: 5000, cleared: "reconciled" });
  });
});
