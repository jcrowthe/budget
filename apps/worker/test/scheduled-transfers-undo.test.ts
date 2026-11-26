import { describe, expect, it } from "vitest";
import { account, body, type Json, plan, q, S, sched, send, TODAY } from "./scheduled-helpers";
import { setOf, undo } from "./undo-helpers";

const mk = (a: string, b: string, extra: Json = {}) => ({
  account_id: a,
  transfer_account_id: b,
  date_first: "2026-12-01",
  frequency: "monthly",
  amount: -100000,
  memo: "ZZ-TEST undo",
  ...extra,
});
const list = async (bid: string, accountId?: string): Promise<Json[]> => {
  const qs = accountId ? `&account_id=${accountId}` : "";
  return (await body(await send(`${S(bid)}?today=${TODAY}${qs}`, "GET"))).scheduled_transactions;
};
const row = async (id: string) =>
  (
    await q(
      "select transfer_account_id, payee_id, amount, memo, deleted_at from scheduled_transactions where id = ?",
      id,
    )
  )[0] as Json;
async function two() {
  const b = await plan();
  const a = await account(b, "checking", 0);
  const s = await account(b, "savings", 0);
  const s2 = await account(b, "savings", 0);
  return { b, a, s, s2 };
}
const patch = (b: string, id: string, input: Json) =>
  send(`${S(b)}/${id}?today=${TODAY}`, "PATCH", input);

describe("scheduled transfers: undo", () => {
  it("undo of a create removes the series from both lists", async () => {
    const { b, a, s } = await two();
    const res = await send(`${S(b)}?today=${TODAY}`, "POST", mk(a, s));
    expect(res.status).toBe(201);
    const r = await undo(b, setOf(res));
    expect(r.status).toBe(200);
    expect(await list(b, a)).toHaveLength(0);
    expect(await list(b, s)).toHaveLength(0);
  });

  it("undo of a delete (from the mirror side) brings both rows back", async () => {
    const { b, a, s } = await two();
    const t = (await sched(b, mk(a, s))).scheduled_transaction;
    const del = await send(`${S(b)}/${t.id}`, "DELETE");
    expect(del.status).toBe(200);
    expect(await list(b)).toHaveLength(0);
    const u = await undo(b, setOf(del));
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(await list(b, a)).toHaveLength(1);
    expect((await list(b, s))[0]).toMatchObject({ mirror: true, id: t.id });
  });

  it("undo of edits restores amount, memo, re-target, plain to transfer and transfer to plain", async () => {
    const { b, a, s, s2 } = await two();
    const t = (await sched(b, mk(a, s))).scheduled_transaction;
    let res = await patch(b, t.id, { amount: -5000, memo: "ZZ-TEST changed" });
    expect(res.status).toBe(200);
    expect((await undo(b, setOf(res))).status).toBe(200);
    expect(await row(t.id)).toMatchObject({ amount: -100000, memo: "ZZ-TEST undo" });

    res = await patch(b, t.id, { transfer_account_id: s2 });
    expect(res.status).toBe(200);
    expect((await row(t.id)).transfer_account_id).toBe(s2);
    expect((await undo(b, setOf(res))).status).toBe(200);
    expect((await row(t.id)).transfer_account_id).toBe(s);

    res = await patch(b, t.id, { transfer_account_id: null, payee_name: "ZZ Back" });
    expect(res.status).toBe(200);
    expect((await row(t.id)).transfer_account_id).toBeNull();
    expect((await undo(b, setOf(res))).status).toBe(200);
    expect((await row(t.id)).transfer_account_id).toBe(s);
    expect((await list(b, s))[0].mirror).toBe(true);

    const plain = (
      await sched(b, {
        account_id: a,
        date_first: "2026-12-01",
        frequency: "monthly",
        amount: -1,
        payee_name: "ZZ P",
      })
    ).scheduled_transaction;
    const before = await row(plain.id);
    res = await patch(b, plain.id, { transfer_account_id: s });
    expect(res.status).toBe(200);
    expect((await row(plain.id)).payee_id).toBeNull();
    expect((await undo(b, setOf(res))).status).toBe(200);
    expect(await row(plain.id)).toEqual(before);
  });

  it("undo of an edit is refused once the original transfer account is deleted", async () => {
    const { b, a, s, s2 } = await two();
    const t = (await sched(b, mk(a, s))).scheduled_transaction;
    const res = await patch(b, t.id, { transfer_account_id: s2 });
    expect(res.status).toBe(200);
    const del = await send(`/api/v1/budgets/${b}/accounts/${s}`, "DELETE");
    expect(del.status).toBe(200);
    const r = await undo(b, setOf(res));
    expect(r.status).toBe(409);
    expect((await row(t.id)).transfer_account_id).toBe(s2);
  });
});
