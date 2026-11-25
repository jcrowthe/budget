import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { send } from "./account-helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";
import { addRule } from "./rename-rules-helpers";
import { setOf, undo } from "./undo-helpers";

const q = async (sql: string, ...args: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...args)
      .all<Json>()
  ).results;

/** The columns an undo must return, without the timestamps. */
async function state(bid: string) {
  return {
    payees: await q(
      "select id, name, hidden, deleted_at is null live from payees where budget_id = ? order by id",
      bid,
    ),
    tx: await q(
      "select id, payee_id, payee_name, deleted_at is null live from transactions where budget_id = ? order by id",
      bid,
    ),
    sched: await q(
      "select id, payee_id, deleted_at is null live from scheduled_transactions where budget_id = ? order by id",
      bid,
    ),
    rules: await q(
      "select id, payee_id, kind, text, deleted_at is null live from payee_rename_rules where budget_id = ? order by id",
      bid,
    ),
  };
}

describe("undo of a combine (EXF-512 AC6)", () => {
  it("restores every payee, rule and row; redo combines again", async () => {
    const w = await payeeWorld();
    for (let i = 0; i < 3; i++) await w.tx("ZZ-TEST A");
    await w.tx("ZZ-TEST B");
    await w.tx("ZZ-TEST X", {
      amount: -3000,
      subtransactions: [
        { amount: -1000, payee_name: "ZZ-TEST B" },
        { amount: -2000, payee_name: "ZZ-TEST X" },
      ],
    });
    await w.sched("ZZ-TEST B");
    await w.tx("ZZ-TEST C");
    const [a, b, c] = [await w.id("ZZ-TEST A"), await w.id("ZZ-TEST B"), await w.id("ZZ-TEST C")];
    await addRule(w.bid, a, "contains", "zzx");
    await addRule(w.bid, b, "contains", "zzx");
    await addRule(w.bid, b, "is", "zz b");

    const before = await state(w.bid);
    const res = await send(`${P(w.bid)}/combine`, "POST", {
      payee_ids: [a, b, c],
      name: "ZZ-TEST ABC",
      target_payee_id: a,
    });
    expect(res.status).toBe(200);
    const combined = await state(w.bid);
    expect(combined).not.toEqual(before);

    const u = await undo(w.bid, setOf(res));
    expect(u.status).toBe(200);
    expect(u.body.data.where).toMatchObject({ surface: "payees" });
    expect(await state(w.bid)).toEqual(before);
    const names = (await w.list()).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST C"]));
    expect(names).not.toContain("ZZ-TEST ABC");

    const redo = await undo(w.bid, u.header as string);
    expect(redo.status).toBe(200);
    expect(await state(w.bid)).toEqual(combined);
  });
});
