import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { data, send } from "./account-helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";
import { addRule } from "./rename-rules-helpers";
import { setOf, undo } from "./undo-helpers";

const q = async (sql: string, ...args: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...args)
      .all<Json>()
  ).results;

/** P: 3 transactions, 1 schedule and a rule; R: 1 transaction. */
async function world() {
  const w = await payeeWorld();
  for (let i = 0; i < 3; i++) await w.tx("ZZ P");
  await w.sched("ZZ P");
  await w.tx("ZZ R");
  const [p, r] = [await w.id("ZZ P"), await w.id("ZZ R")];
  const rule = await addRule(w.bid, p, "contains", "zz p");
  return { ...w, p, r, rule };
}
const rowsOf = (p: string) =>
  q("select payee_id, payee_name from transactions where payee_id = ? and deleted_at is null", p);

describe("undo of a payee delete that moved rows (EXF-882 item 3)", () => {
  it("delete with a replacement, undo, redo", async () => {
    const w = await world();
    const del = await send(`${P(w.bid)}/${w.p}?replacement_payee_id=${w.r}`, "DELETE");
    expect(del.status).toBe(200);
    const set = setOf(del);
    expect(await rowsOf(w.p)).toHaveLength(0);

    const u = await undo(w.bid, set);
    expect(u.status).toBe(200);
    expect(u.body.data.where).toMatchObject({ surface: "payees" });
    expect((await q("select deleted_at from payees where id = ?", w.p))[0]?.deleted_at).toBeNull();
    expect(
      (await q("select deleted_at d from payee_rename_rules where id = ?", w.rule.id))[0]?.d,
    ).toBeNull();
    const back = await rowsOf(w.p);
    expect(back).toHaveLength(3);
    for (const t of back) expect(t.payee_name).toBe("ZZ P");
    expect(
      await q(
        "select id from scheduled_transactions where payee_id = ? and deleted_at is null",
        w.p,
      ),
    ).toHaveLength(1);
    const reg = (
      await data(await send(`/api/v1/budgets/${w.bid}/accounts/${w.acct}/transactions`, "GET"))
    ).transactions as Json[];
    expect(reg.filter((t) => t.payee_name === "ZZ P")).toHaveLength(3);

    const redo = await undo(w.bid, u.header as string);
    expect(redo.status).toBe(200);
    const moved = await q(
      "select payee_name from transactions where payee_id = ? and deleted_at is null",
      w.r,
    );
    expect(moved).toHaveLength(4);
    for (const t of moved) expect(t.payee_name).toBe("ZZ R");
    expect(await rowsOf(w.p)).toHaveLength(0);
    expect(
      await q(
        "select id from scheduled_transactions where payee_id = ? and deleted_at is null",
        w.r,
      ),
    ).toHaveLength(1);
    expect(
      (await q("select deleted_at from payees where id = ?", w.p))[0]?.deleted_at,
    ).not.toBeNull();
    expect(
      (await q("select deleted_at d from payee_rename_rules where id = ?", w.rule.id))[0]?.d,
    ).not.toBeNull();
  });

  it("delete without a replacement: the rows come back to the payee", async () => {
    const w = await world();
    const del = await send(`${P(w.bid)}/${w.p}`, "DELETE");
    expect(del.status).toBe(200);
    expect(
      (
        await q(
          "select count(*) n from transactions where payee_id is null and budget_id = ?",
          w.bid,
        )
      )[0]?.n,
    ).toBe(3);
    const u = await undo(w.bid, setOf(del));
    expect(u.status).toBe(200);
    const back = await rowsOf(w.p);
    expect(back).toHaveLength(3);
    for (const t of back) expect(t.payee_name).toBe("ZZ P");
  });

  it("the set logs one row per moved row, before and after", async () => {
    const w = await world();
    const set = setOf(await send(`${P(w.bid)}/${w.p}?replacement_payee_id=${w.r}`, "DELETE"));
    const tx = await q(
      "select before_json b, after_json a from change_log where change_set_id = ? and entity_type = 'transaction'",
      set,
    );
    expect(tx).toHaveLength(3);
    for (const row of tx) {
      expect(JSON.parse(row.b)).toMatchObject({ payee_id: w.p, payee_name: "ZZ P" });
      expect(JSON.parse(row.a)).toMatchObject({ payee_id: w.r, payee_name: "ZZ R" });
    }
    const sc = await q(
      "select before_json b, after_json a from change_log where change_set_id = ? and entity_type = 'scheduled_transaction'",
      set,
    );
    expect(sc).toHaveLength(1);
    expect(JSON.parse(sc[0]?.b)).toMatchObject({ payee_id: w.p });
    expect(JSON.parse(sc[0]?.a)).toMatchObject({ payee_id: w.r });
  });

  it("a set written before the move rows existed is still refused", async () => {
    const w = await world();
    const set = crypto.randomUUID();
    await env.DB.prepare(
      "insert into change_log (id, budget_id, actor, action, entity_type, entity_id, before_json, after_json, created_at, change_set_id) values (?, ?, 'user:tester@localhost', 'delete', 'payee', ?, ?, ?, '2026-11-10T00:00:00.000Z', ?)",
    )
      .bind(
        crypto.randomUUID(),
        w.bid,
        w.p,
        JSON.stringify({ id: w.p, name: "ZZ P" }),
        JSON.stringify({ transactions_moved: 2, scheduled_moved: 0 }),
        set,
      )
      .run();
    const u = await undo(w.bid, set);
    expect(u.status).toBe(409);
    expect(u.body.error.name).toBe("undo_refused");
  });
});
