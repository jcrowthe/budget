import { describe, expect, it } from "vitest";
import { category } from "./bulk-helpers";
import {
  account,
  body,
  enter,
  type Json,
  plan,
  q,
  S,
  sched,
  send,
  TODAY,
} from "./scheduled-helpers";
import { setOf, undo } from "./undo-helpers";

const patch = (b: string, id: string, input: Json) =>
  send(`${S(b)}/${id}?today=${TODAY}`, "PATCH", input);
async function world() {
  const b = await plan();
  const a = await account(b);
  const c1 = await category(b, "Groceries");
  const c2 = await category(b, "Transportation");
  const input = {
    account_id: a,
    date_first: "2026-11-28",
    frequency: "monthly",
    amount: -40000,
    subtransactions: [
      { amount: -30000, category_id: c1, memo: "ZZ-TEST one" },
      { amount: -10000, category_id: c2 },
    ],
  };
  return { b, a, c1, c2, input };
}
const live = async (id: string) =>
  q(
    "select amount, category_id, memo, sort from scheduled_subtransactions where scheduled_transaction_id = ? and deleted_at is null order by sort",
    id,
  );
const parent = async (id: string) =>
  (
    await q(
      "select amount, category_id, date_next, deleted_at from scheduled_transactions where id = ?",
      id,
    )
  )[0] as Json;

describe("scheduled splits: undo", () => {
  it("undo of a create removes the schedule", async () => {
    const w = await world();
    const res = await send(`${S(w.b)}?today=${TODAY}`, "POST", w.input);
    const id = (await body(res.clone())).scheduled_transaction.id;
    const u = await undo(w.b, setOf(res));
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect((await parent(id)).deleted_at).not.toBeNull();
  });

  it("undo of an edit that replaced the lines brings the old ones back", async () => {
    const w = await world();
    const id = (await sched(w.b, w.input)).scheduled_transaction.id;
    const old = await live(id);
    const res = await patch(w.b, id, {
      amount: -45000,
      subtransactions: [
        { amount: -30000, category_id: w.c1 },
        { amount: -10000, category_id: w.c2 },
        { amount: -5000, category_id: w.c2 },
      ],
    });
    expect(res.status).toBe(200);
    expect(await live(id)).toHaveLength(3);
    const u = await undo(w.b, setOf(res));
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(await live(id)).toEqual(old);
    expect((await parent(id)).amount).toBe(-40000);
  });

  it("undo of plain to split and of split to plain", async () => {
    const w = await world();
    const id = (
      await sched(w.b, {
        account_id: w.a,
        date_first: "2026-11-28",
        frequency: "monthly",
        amount: -40000,
        category_id: w.c1,
      })
    ).scheduled_transaction.id;
    const toSplit = await patch(w.b, id, { subtransactions: w.input.subtransactions });
    expect(toSplit.status).toBe(200);
    expect(await live(id)).toHaveLength(2);
    expect((await undo(w.b, setOf(toSplit))).status).toBe(200);
    expect(await live(id)).toHaveLength(0);
    expect((await parent(id)).category_id).toBe(w.c1);
    const again = await patch(w.b, id, { subtransactions: w.input.subtransactions });
    expect(again.status).toBe(200);
    const toPlain = await patch(w.b, id, { subtransactions: [], category_id: w.c2 });
    expect(toPlain.status).toBe(200);
    expect(await live(id)).toHaveLength(0);
    expect((await undo(w.b, setOf(toPlain))).status).toBe(200);
    expect(await live(id)).toHaveLength(2);
    expect((await parent(id)).category_id).toBeNull();
  });

  it("undo of a delete restores the schedule with its lines", async () => {
    const w = await world();
    const id = (await sched(w.b, w.input)).scheduled_transaction.id;
    const del = await send(`${S(w.b)}/${id}`, "DELETE");
    expect(del.status).toBe(200);
    expect((await undo(w.b, setOf(del))).status).toBe(200);
    const list = (await body(await send(`${S(w.b)}?today=${TODAY}`, "GET"))).scheduled_transactions;
    expect(list[0].subtransactions).toHaveLength(2);
  });

  it("undo of Enter Now removes the real split and restores the next date", async () => {
    const w = await world();
    const id = (await sched(w.b, w.input)).scheduled_transaction.id;
    const res = await enter(w.b, id);
    expect(res.status).toBe(201);
    const txId = (await body(res.clone())).transaction.id;
    expect((await parent(id)).date_next).toBe("2026-12-28");
    const u = await undo(w.b, setOf(res));
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect((await parent(id)).date_next).toBe("2026-11-28");
    const rows = await q(
      "select count(*) n from transactions where (id = ? or parent_transaction_id = ?) and deleted_at is null",
      txId,
      txId,
    );
    expect(rows[0]?.n).toBe(0);
    expect(await live(id)).toHaveLength(2);
  });
});
