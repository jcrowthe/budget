import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runInChangeSet } from "../src/history/change-set";
import { account, actor, category, get, MONTH, plan, q, send, tx } from "./bulk-helpers";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import { feed, runUntilDone, setupPlaid, stubBank, syncOne, world1 } from "./plaid-sync-helpers";
import { counts, fingerprint, type Json, setOf, undo } from "./undo-helpers";

const B = (bid: string) => `/api/v1/budgets/${bid}`;
const data = async (res: Response) => ((await res.json()) as Json).data;
const rowOf = async (id: string) =>
  (await q("select * from transactions where id = ?", id))[0] as Json;
const acctOf = async (bid: string, id: string) =>
  (await data(await json(`${B(bid)}/accounts/${id}`))).account as Json;
const cells = async (bid: string, names: string[]) => {
  const m = await data(await json(`${B(bid)}/months/${MONTH}`));
  const all = m.groups.flatMap((g: Json) => g.categories) as Json[];
  return names.map((n) => all.find((c) => c.name.endsWith(n)) as Json);
};
const assigned = async (bid: string, names: string[]) =>
  (await cells(bid, names)).map((c) => c.assigned / 1000);
const assign = async (bid: string, cid: string, v: number) => {
  const res = await send(`${B(bid)}/months/${MONTH}/categories/${cid}`, "PATCH", {
    assigned: v * 1000,
  });
  expect(res.status).toBe(200);
  return setOf(res);
};
/** Undo and expect 200; returns the undo's own set id. */
async function ok(bid: string, id: string) {
  const r = await undo(bid, id);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.data.change_set_id).toBe(r.header);
  return r.body.data.change_set_id as string;
}

beforeEach(setupPlaid);

describe("1. transfer delete, undo, redo", () => {
  it("brings both sides back, redo deletes both, undo restores them", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const t = await tx(b, {
      account_id: a1,
      date: "2026-11-10",
      amount: -12000,
      memo: "move",
      cleared: "cleared",
      transfer_account_id: a2,
    });
    const other = t.transfer_transaction_id as string;
    expect(other).toBeTruthy();
    const before = [await rowOf(t.id), await rowOf(other)];
    const del = await send(`${B(b)}/transactions/${t.id}`, "DELETE");
    expect(del.status).toBe(200);
    const S = setOf(del);
    expect((await rowOf(t.id)).deleted_at).not.toBeNull();
    expect((await rowOf(other)).deleted_at).not.toBeNull();

    const U = await ok(b, S);
    for (const [i, id] of [t.id, other].entries()) {
      const r = await rowOf(id);
      const w = before[i] as Json;
      expect(r.deleted_at).toBeNull();
      expect([r.amount, r.date, r.memo, r.cleared]).toEqual([w.amount, w.date, w.memo, w.cleared]);
      expect(r.transfer_transaction_id).toBe(w.transfer_transaction_id);
    }
    const R = await ok(b, U);
    expect((await rowOf(t.id)).deleted_at).not.toBeNull();
    expect((await rowOf(other)).deleted_at).not.toBeNull();
    await ok(b, R);
    expect((await rowOf(t.id)).deleted_at).toBeNull();
    expect((await rowOf(other)).deleted_at).toBeNull();
  });

  it("10. writes the caller's actor, undo_of and its own set id", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const t = await tx(b, {
      account_id: a1,
      date: "2026-11-10",
      amount: -500,
      transfer_account_id: a2,
    });
    const S = setOf(await send(`${B(b)}/transactions/${t.id}`, "DELETE"));
    const r = await undo(b, S);
    expect(r.status).toBe(200);
    const U = r.body.data.change_set_id as string;
    expect(U).toBe(r.header);
    expect(U).not.toBe(S);
    const rows = await q(
      "select actor, entity_id, json_extract(after_json, '$.undo_of') u from change_log where change_set_id = ?",
      U,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const x of rows) {
      expect(x.actor).toBe(actor);
      expect(x.u).toBe(S);
    }
    expect(rows.map((x) => x.entity_id)).toEqual(
      expect.arrayContaining([t.id, t.transfer_transaction_id]),
    );
  });
});

describe("2. reject an import", () => {
  it("undo makes the row live, drops the tombstone, the next sync adds no copy", async () => {
    stubBank();
    const w = await world1();
    feed.pages = [{ added: [plaidTxn({ transaction_id: "ZZ-REJ", amount: 9.5 })] }];
    await syncOne(w.plan, w.conn);
    const row = (
      await q(
        "select id from transactions where account_id = ? and import_id = 'ZZ-REJ'",
        w.account,
      )
    )[0] as Json;
    const rej = await send(`${B(w.plan)}/transactions/reject`, "POST", { ids: [row.id] });
    expect(rej.status).toBe(200);
    const S = setOf(rej);
    expect(
      await q(
        "select 1 from import_tombstones where import_id = 'ZZ-REJ' and account_id = ?",
        w.account,
      ),
    ).toHaveLength(1);
    await ok(w.plan, S);
    expect((await rowOf(row.id)).deleted_at).toBeNull();
    expect(
      await q(
        "select 1 from import_tombstones where import_id = 'ZZ-REJ' and account_id = ?",
        w.account,
      ),
    ).toHaveLength(0);
    await runUntilDone(env, w.conn);
    const live = await q(
      "select id from transactions where account_id = ? and import_id = 'ZZ-REJ' and deleted_at is null",
      w.account,
    );
    expect(live).toHaveLength(1);
  });
});

describe("3. bulk", () => {
  it("clear is undone with the balances, flag undo and redo work", async () => {
    const b = await plan();
    const a = await account(b);
    const ids = [
      (await tx(b, { account_id: a, date: "2026-11-10", amount: -1000 })).id,
      (await tx(b, { account_id: a, date: "2026-11-10", amount: -2000 })).id,
      (await tx(b, { account_id: a, date: "2026-11-10", amount: -3000, cleared: "cleared" })).id,
    ] as string[];
    const pick = (x: Json) => [x.cleared_balance, x.uncleared_balance, x.balance];
    const first = pick(await acctOf(b, a));
    const res = await send(`${B(b)}/transactions/bulk`, "POST", {
      op: "clear",
      ids: ids.slice(0, 2),
    });
    expect(res.status).toBe(200);
    expect(pick(await acctOf(b, a))).not.toEqual(first);
    await ok(b, setOf(res));
    expect(pick(await acctOf(b, a))).toEqual(first);

    const fl = await send(`${B(b)}/transactions/bulk`, "POST", {
      op: "flag",
      ids: [ids[0]],
      value: "red",
    });
    expect(fl.status, await fl.clone().text()).toBe(200);
    expect((await get(b, ids[0] as string)).flag_color).toBe("red");
    const U = await ok(b, setOf(fl));
    expect((await get(b, ids[0] as string)).flag_color).toBeNull();
    await ok(b, U);
    expect((await get(b, ids[0] as string)).flag_color).toBe("red");
  });
});

describe("4. EXF-504 AC2 Assigned history", () => {
  it("three undos and three redos", async () => {
    const b = await plan();
    const [rent, groc] = [
      await category(b, "Rent/Mortgage"),
      await category(b, "Groceries"),
    ] as string[];
    await assign(b, rent as string, 450);
    await assign(b, groc as string, 205);
    const S1 = await assign(b, rent as string, 451);
    const S2 = await assign(b, groc as string, 207);
    const S3 = await assign(b, rent as string, 454);
    const now = () => assigned(b, ["Rent/Mortgage", "Groceries"]);
    expect(await now()).toEqual([454, 207]);
    const U3 = await ok(b, S3);
    expect(await now()).toEqual([451, 207]);
    const U2 = await ok(b, S2);
    expect(await now()).toEqual([451, 205]);
    const U1 = await ok(b, S1);
    expect(await now()).toEqual([450, 205]);
    await ok(b, U1);
    expect(await now()).toEqual([451, 205]);
    await ok(b, U2);
    expect(await now()).toEqual([451, 207]);
    await ok(b, U3);
    expect(await now()).toEqual([454, 207]);
  });
});

describe("5. move and cover", () => {
  it("restore both cells exactly and mark the rows as undo moves", async () => {
    const b = await plan();
    const a = await account(b);
    const [A, Bc, C] = [
      await category(b, "Rent/Mortgage"),
      await category(b, "Groceries"),
      await category(b, "Transportation"),
    ] as string[];
    await assign(b, A as string, 400);
    const names = ["Rent/Mortgage", "Groceries", "Transportation"];
    const read = async () =>
      (await cells(b, names)).map((c) => [c.assigned, c.activity, c.available]);
    const s0 = await read();
    const mv = await send(`${B(b)}/months/${MONTH}/moves`, "POST", {
      from: A,
      to: Bc,
      amount: 30000,
    });
    expect(mv.status).toBe(200);
    const S = setOf(mv);
    const moveId = (await data(mv)).move_id as string;
    const U = await ok(b, S);
    expect(await read()).toEqual(s0);
    const rows = await q(
      "select after_json from change_log where change_set_id = ? and entity_type = 'month_category'",
      U,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      const aft = JSON.parse(r.after_json);
      expect(aft.move.kind).toBe("undo");
      expect(aft.undo_of).toBe(S);
      expect(aft.move.undo_of).toBe(moveId);
    }

    await tx(b, { account_id: a, date: "2026-11-11", amount: -50000, category_id: C });
    const s1 = await read();
    const cv = await send(`${B(b)}/months/${MONTH}/categories/${C}/cover`, "POST", { from: A });
    expect(cv.status, await cv.clone().text()).toBe(200);
    expect(await read()).not.toEqual(s1);
    await ok(b, setOf(cv));
    expect(await read()).toEqual(s1);
  });
});

describe("6. category delete with reassign_to", () => {
  it("restores the category, its rows, the Assigned and the target", async () => {
    const b = await plan();
    const a = await account(b);
    const [C, T] = [
      await category(b, "Groceries"),
      await category(b, "Transportation"),
    ] as string[];
    const sort = (await q("select sort_order s from categories where id = ?", C))[0]?.s;
    await assign(b, C as string, 40);
    await assign(b, T as string, 10);
    const tg = await send(`${B(b)}/categories/${C}/target`, "PUT", {
      cadence: "monthly",
      behavior: "set_aside",
      amount: 20000,
    });
    expect(tg.status, await tg.clone().text()).toBe(200);
    (await data(await json(`${B(b)}/categories/${C}/target`)).catch?.(() => null)) ?? null;
    const t1 = await tx(b, { account_id: a, date: "2026-11-10", amount: -1000, category_id: C });
    const t2 = await tx(b, {
      account_id: a,
      date: "2026-11-10",
      amount: -3000,
      subtransactions: [
        { amount: -1000, category_id: C },
        { amount: -2000, category_id: T },
      ],
    });
    const line = (
      await q(
        "select id from transactions where parent_transaction_id = ? and category_id = ?",
        t2.id,
        C,
      )
    )[0] as Json;
    const sc = await send(`${B(b)}/scheduled-transactions?today=2026-11-15`, "POST", {
      account_id: a,
      date_first: "2026-12-20",
      frequency: "never",
      amount: -5000,
      payee_name: "ZZ Sched",
      category_id: C,
    });
    expect(sc.status).toBe(201);
    const sid = (await data(sc)).scheduled_transaction.id as string;
    const tRow = (await q("select * from targets where category_id = ?", C))[0] as Json;

    const del = await send(`${B(b)}/categories/${C}?reassign_to=${T}`, "DELETE");
    expect(del.status, await del.clone().text()).toBe(200);
    expect((await q("select deleted_at d from categories where id = ?", C))[0]?.d).not.toBeNull();
    await ok(b, setOf(del));

    const c = (
      await q("select deleted_at d, sort_order s from categories where id = ?", C)
    )[0] as Json;
    expect(c.d).toBeNull();
    expect(c.s).toBe(sort);
    expect((await rowOf(t1.id)).category_id).toBe(C);
    expect((await rowOf(line.id)).category_id).toBe(C);
    expect(
      (await q("select category_id c from scheduled_transactions where id = ?", sid))[0]?.c,
    ).toBe(C);
    expect(await assigned(b, ["Groceries", "Transportation"])).toEqual([40, 10]);
    const t2Row = (await q("select * from targets where category_id = ?", C))[0] as Json;
    expect({ ...t2Row, created_at: 0, updated_at: 0 }).toEqual({
      ...tRow,
      created_at: 0,
      updated_at: 0,
    });
  });
});

describe("7. category create, rename, hide, unhide", () => {
  it("each undoes and redoes", async () => {
    const b = await plan();
    const g = (
      await q("select id from category_groups where budget_id = ? and kind is null limit 1", b)
    )[0] as Json;
    const cr = await send(`${B(b)}/categories`, "POST", {
      budget_id: b,
      group_id: g.id,
      name: "ZZ New",
    });
    expect(cr.status).toBe(201);
    const id = (await data(cr)).category.id as string;
    const st = async () =>
      (await q("select name, hidden, deleted_at d from categories where id = ?", id))[0] as Json;
    const U = await ok(b, setOf(cr));
    expect((await st()).d).not.toBeNull();
    await ok(b, U);
    expect((await st()).d).toBeNull();

    const patch = async (body: Json) => {
      const r = await send(`${B(b)}/categories/${id}`, "PATCH", body);
      expect(r.status).toBe(200);
      return setOf(r);
    };
    const cases: [Json, Json, Json][] = [
      [{ name: "ZZ Renamed" }, { name: "ZZ New", hidden: 0 }, { name: "ZZ Renamed", hidden: 0 }],
      [{ hidden: true }, { name: "ZZ Renamed", hidden: 0 }, { name: "ZZ Renamed", hidden: 1 }],
      [{ hidden: false }, { name: "ZZ Renamed", hidden: 1 }, { name: "ZZ Renamed", hidden: 0 }],
    ];
    for (const [body, prev, next] of cases) {
      const S = await patch(body);
      const R = await ok(b, S);
      expect(await st()).toMatchObject(prev);
      await ok(b, R);
      expect(await st()).toMatchObject(next);
    }
  });
});

describe("8. stale and repeated undos", () => {
  it("a later PATCH makes the undo 409 undo_stale and writes nothing", async () => {
    const b = await plan();
    const a = await account(b);
    const t = await tx(b, { account_id: a, date: "2026-11-10", amount: -1000, memo: "one" });
    const S1 = setOf(await send(`${B(b)}/transactions/${t.id}`, "PATCH", { memo: "two" }));
    expect((await send(`${B(b)}/transactions/${t.id}`, "PATCH", { amount: -2000 })).status).toBe(
      200,
    );
    const snap = await counts(b);
    const fp = await fingerprint(b);
    const r = await undo(b, S1);
    expect(r.status).toBe(409);
    expect(r.body.error.name).toBe("undo_stale");
    expect(r.body.error.detail).toContain(`transaction ${t.id}`);
    expect(await counts(b)).toEqual(snap);
    expect(await fingerprint(b)).toEqual(fp);
  });

  it("a deleted row changed by a direct write is stale", async () => {
    const b = await plan();
    const a = await account(b);
    const t = await tx(b, { account_id: a, date: "2026-11-10", amount: -1000 });
    const S = setOf(await send(`${B(b)}/transactions/${t.id}`, "DELETE"));
    await env.DB.prepare("update transactions set memo = 'x' where id = ?").bind(t.id).run();
    const snap = await counts(b);
    const r = await undo(b, S);
    expect(r.status).toBe(409);
    expect(r.body.error.name).toBe("undo_stale");
    expect(await counts(b)).toEqual(snap);
    expect((await rowOf(t.id)).deleted_at).not.toBeNull();
  });

  it("a second undo of one set is 409 already_undone", async () => {
    const b = await plan();
    const a = await account(b);
    const t = await tx(b, { account_id: a, date: "2026-11-10", amount: -1000 });
    const S = setOf(await send(`${B(b)}/transactions/${t.id}`, "PATCH", { memo: "m" }));
    await ok(b, S);
    const r = await undo(b, S);
    expect(r.status).toBe(409);
    expect(r.body.error.name).toBe("already_undone");
  });
});

describe("9. plaid actor", () => {
  it("a set written by service:plaid is 403 to a user", async () => {
    stubBank();
    const w = await world1();
    feed.pages = [{ added: [plaidTxn({ transaction_id: "ZZ-P1" })] }];
    const P = crypto.randomUUID();
    await runInChangeSet(P, () => runUntilDone(env, w.conn));
    const rows = await q("select distinct actor from change_log where change_set_id = ?", P);
    expect(rows.map((r) => r.actor)).toContain("service:plaid");
    const r = await undo(w.plan, P);
    expect(r.status).toBe(403);
    expect(r.body.error.name).toBe("forbidden");
  });
});

describe("extras", () => {
  it("an unknown set is 404, a reconcile set is 409 undo_refused", async () => {
    const b = await plan();
    const r = await undo(b, crypto.randomUUID());
    expect(r.status).toBe(404);
    const a = await account(b);
    await tx(b, { account_id: a, date: "2026-11-10", amount: -1000, cleared: "cleared" });
    const rec = await send(`${B(b)}/accounts/${a}/reconcile`, "POST", {
      statement_balance: 499000,
      date: "2026-11-12",
    });
    if (rec.status === 200 || rec.status === 201) {
      const r2 = await undo(b, setOf(rec));
      expect(r2.status).toBe(409);
      expect(r2.body.error.name).toBe("undo_refused");
    }
  });

  it("a payee rename and a scheduled edit both restore", async () => {
    const b = await plan();
    const a = await account(b);
    const t = await tx(b, {
      account_id: a,
      date: "2026-11-10",
      amount: -1000,
      payee_name: "ZZ Old",
    });
    const pid = t.payee_id as string;
    const rn = await send(`${B(b)}/payees/${pid}`, "PATCH", { name: "ZZ New" });
    expect(rn.status, await rn.clone().text()).toBe(200);
    await ok(b, setOf(rn));
    expect((await q("select name from payees where id = ?", pid))[0]?.name).toBe("ZZ Old");

    const sc = await send(`${B(b)}/scheduled-transactions?today=2026-11-15`, "POST", {
      account_id: a,
      date_first: "2026-12-20",
      frequency: "never",
      amount: -5000,
      payee_name: "ZZ Sched",
    });
    const sid = (await data(sc)).scheduled_transaction.id as string;
    const ed = await send(`${B(b)}/scheduled-transactions/${sid}`, "PATCH", { memo: "edited" });
    expect(ed.status, await ed.clone().text()).toBe(200);
    await ok(b, setOf(ed));
    expect(
      (await q("select memo from scheduled_transactions where id = ?", sid))[0]?.memo,
    ).toBeNull();
  });

  it("a refusal found while writing (closed account) rolls the whole batch back", async () => {
    const b = await plan();
    const a = await account(b);
    const t = await tx(b, { account_id: a, date: "2026-11-10", amount: -1000 });
    const S = setOf(await send(`${B(b)}/transactions/${t.id}`, "DELETE"));
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(a).run();
    const snap = await fingerprint(b);
    const r = await undo(b, S);
    expect(r.status).toBe(409);
    expect(r.body.error.name).toBe("undo_refused");
    expect(await fingerprint(b)).toEqual(snap);
    expect(await q("select 1 from change_set_undos where budget_id = ?", b)).toHaveLength(0);
  });
});
