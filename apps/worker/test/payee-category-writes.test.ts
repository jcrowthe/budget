import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { rejectTransactions } from "../src/services/transactions";
import { data, send } from "./account-helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";

const ACTOR = "user:tester@localhost";

async function world() {
  const w = await payeeWorld();
  const g = (
    await data(await send(`/api/v1/budgets/${w.bid}/category_groups`, "POST", { name: "ZZ G" }))
  ).category_group as Json;
  const ids: Record<string, string> = {};
  for (const name of ["Fun", "Groceries", "Rent"]) {
    ids[name] = (
      await data(
        await send(`/api/v1/budgets/${w.bid}/categories`, "POST", {
          group_id: g.id,
          name: `ZZ ${name}`,
        }),
      )
    ).category.id as string;
  }
  const enter = (payee: string, date: string, category: string | null, over: Json = {}) =>
    w.tx(payee, { date, ...(category ? { category_id: ids[category] } : {}), ...over });
  const payee = async (name: string) => (await w.list()).find((p) => p.name === name) as Json;
  const stored = async (name: string) =>
    env.DB.prepare(
      "select default_category_id, default_inflow_to_ready_to_assign rta, updated_at from payees where id = ?",
    )
      .bind((await payee(name)).id)
      .first<Json>();
  const nameIs = async (name: string) => {
    const got = (await payee(name)).default_category_id;
    return Object.entries(ids).find(([, id]) => id === got)?.[0] ?? null;
  };
  const patchTx = (id: string, body: Json) =>
    send(`/api/v1/budgets/${w.bid}/transactions/${id}`, "PATCH", body);
  const payeeLogs = async () =>
    (
      await env.DB.prepare(
        "select count(*) n from change_log where budget_id = ? and entity_type = 'payee'",
      )
        .bind(w.bid)
        .first<Json>()
    ).n as number;
  return { ...w, ids, enter, payee, stored, nameIs, patchTx, payeeLogs };
}

describe("ticket acceptance 1-4 on the server (EXF-515)", () => {
  it("one Fun row gives Fun", async () => {
    const s = await world();
    await s.enter("ZZ P", "2026-11-10", "Fun");
    expect(await s.nameIs("ZZ P")).toBe("Fun");
  });

  it("G 11/10, G 11/11, F 11/12 give G", async () => {
    const s = await world();
    await s.enter("ZZ P", "2026-11-10", "Groceries");
    await s.enter("ZZ P", "2026-11-11", "Groceries");
    await s.enter("ZZ P", "2026-11-12", "Fun");
    expect(await s.nameIs("ZZ P")).toBe("Groceries");
  });

  it("G 11/10, F 11/12 give G", async () => {
    const s = await world();
    await s.enter("ZZ P", "2026-11-10", "Groceries");
    await s.enter("ZZ P", "2026-11-12", "Fun");
    expect(await s.nameIs("ZZ P")).toBe("Groceries");
  });

  it("fixed Fun gives Fun whatever the history", async () => {
    const s = await world();
    await s.enter("ZZ P", "2026-11-10", "Groceries");
    await s.enter("ZZ P", "2026-11-11", "Groceries");
    const id = (await s.payee("ZZ P")).id;
    const res = await send(`${P(s.bid)}/${id}`, "PATCH", {
      category_mode: "fixed",
      fixed_category_id: s.ids.Fun,
    });
    expect(res.status).toBe(200);
    expect(await s.nameIs("ZZ P")).toBe("Fun");
    await s.enter("ZZ P", "2026-11-12", "Rent");
    expect(await s.nameIs("ZZ P")).toBe("Fun");
  });

  it("off gives null and last_category_id is unchanged", async () => {
    const s = await world();
    await s.enter("ZZ P", "2026-11-10", "Groceries");
    await s.enter("ZZ P", "2026-11-12", "Fun");
    const before = await s.payee("ZZ P");
    const res = await send(`${P(s.bid)}/${before.id}`, "PATCH", { category_mode: "off" });
    expect(res.status).toBe(200);
    const after = await s.payee("ZZ P");
    expect(after.default_category_id).toBeNull();
    expect(after.last_category_id).toBe(before.last_category_id);
    expect(after.last_category_id).toBe(s.ids.Fun);
  });
});

describe("writes recompute the stored default (EXF-515)", () => {
  it("editing the category recomputes", async () => {
    const s = await world();
    const a = await s.enter("ZZ P", "2026-11-10", "Fun");
    await s.enter("ZZ P", "2026-11-11", "Fun");
    await s.enter("ZZ P", "2026-11-12", "Groceries");
    expect(await s.nameIs("ZZ P")).toBe("Fun");
    // Last 3 become Groceries 11/12, Fun 11/11, Groceries 11/10: Groceries holds 2.
    expect((await s.patchTx(a.id, { category_id: s.ids.Groceries })).status).toBe(200);
    expect(await s.nameIs("ZZ P")).toBe("Groceries");
  });

  it("editing the date recomputes (the order changes the majority)", async () => {
    const s = await world();
    await s.enter("ZZ P", "2026-11-01", "Fun");
    await s.enter("ZZ P", "2026-11-02", "Fun");
    const g = await s.enter("ZZ P", "2026-11-10", "Groceries");
    expect(await s.nameIs("ZZ P")).toBe("Fun");
    await s.enter("ZZ P", "2026-11-11", "Groceries");
    expect(await s.nameIs("ZZ P")).toBe("Groceries");
    // Groceries 11/10 moves back to 11/01: the last 3 are now Groceries 11/11, Fun 11/02, Fun 11/01.
    expect((await s.patchTx(g.id, { date: "2026-11-01" })).status).toBe(200);
    expect(await s.nameIs("ZZ P")).toBe("Fun");
  });

  it("moving a row to another payee recomputes both payees", async () => {
    const s = await world();
    const a = await s.enter("ZZ From", "2026-11-10", "Fun");
    await s.enter("ZZ To", "2026-11-10", "Rent");
    await s.enter("ZZ To", "2026-11-11", "Rent");
    expect(await s.nameIs("ZZ From")).toBe("Fun");
    const to = (await s.payee("ZZ To")).id;
    expect((await s.patchTx(a.id, { payee_id: to })).status).toBe(200);
    // From has no rows left but keeps its live default (rule: a live current is kept).
    expect(await s.nameIs("ZZ From")).toBe("Fun");
    expect(await s.nameIs("ZZ To")).toBe("Rent");
    const b = await s.enter("ZZ To", "2026-11-12", "Groceries");
    const c = await s.enter("ZZ To", "2026-11-13", "Groceries");
    expect(await s.nameIs("ZZ To")).toBe("Groceries");
    const from = (await s.payee("ZZ From")).id;
    expect((await s.patchTx(b.id, { payee_id: from })).status).toBe(200);
    expect((await s.patchTx(c.id, { payee_id: from })).status).toBe(200);
    expect(await s.nameIs("ZZ From")).toBe("Groceries");
    expect(await s.nameIs("ZZ To")).toBe("Rent");
  });

  it("deleting a row recomputes", async () => {
    const s = await world();
    await s.enter("ZZ P", "2026-11-10", "Groceries");
    await s.enter("ZZ P", "2026-11-11", "Groceries");
    const f = await s.enter("ZZ P", "2026-11-12", "Fun");
    const f2 = await s.enter("ZZ P", "2026-11-13", "Fun");
    expect(await s.nameIs("ZZ P")).toBe("Fun");
    const res = await send(`/api/v1/budgets/${s.bid}/transactions/${f2.id}`, "DELETE");
    expect(res.status).toBe(200);
    await send(`/api/v1/budgets/${s.bid}/transactions/${f.id}`, "DELETE");
    expect(await s.nameIs("ZZ P")).toBe("Groceries");
  });

  it("two RTA inflows give default_inflow_to_ready_to_assign true and no category", async () => {
    const s = await world();
    await s.enter("ZZ Pay", "2026-11-10", null, { inflow_to_ready_to_assign: true, amount: 5000 });
    await s.enter("ZZ Pay", "2026-11-11", null, { inflow_to_ready_to_assign: true, amount: 5000 });
    const p = await s.payee("ZZ Pay");
    expect(p.default_inflow_to_ready_to_assign).toBe(true);
    expect(p.default_category_id).toBeNull();
  });

  it("rejecting an imported row recomputes", async () => {
    const s = await world();
    await s.enter("ZZ P", "2026-11-08", "Fun");
    await s.enter("ZZ P", "2026-11-09", "Fun");
    const b = await s.enter("ZZ P", "2026-11-11", "Groceries", { approved: false });
    const c = await s.enter("ZZ P", "2026-11-12", "Groceries", { approved: false });
    for (const t of [b, c]) {
      await env.DB.prepare("update transactions set import_id = ?, source = 'plaid' where id = ?")
        .bind(`zz-${t.id}`, t.id)
        .run();
    }
    expect(await s.nameIs("ZZ P")).toBe("Groceries");
    await rejectTransactions(env, ACTOR, s.bid, [b.id, c.id]);
    expect(await s.nameIs("ZZ P")).toBe("Fun");
  });

  it("deleting a payee with a replacement recomputes the replacement", async () => {
    const s = await world();
    await s.enter("ZZ Old", "2026-11-10", "Groceries");
    await s.enter("ZZ Old", "2026-11-11", "Groceries");
    await s.enter("ZZ New", "2026-11-09", "Fun");
    expect(await s.nameIs("ZZ New")).toBe("Fun");
    const oldId = (await s.payee("ZZ Old")).id;
    const newId = (await s.payee("ZZ New")).id;
    const res = await send(`${P(s.bid)}/${oldId}?replacement_payee_id=${newId}`, "DELETE");
    expect(res.status).toBe(200);
    expect(await s.nameIs("ZZ New")).toBe("Groceries");
  });

  it("a deleted fixed category reads null in fixed mode; a deleted stored category falls back in history mode", async () => {
    const s = await world();
    await s.enter("ZZ P", "2026-11-10", "Rent");
    await s.enter("ZZ P", "2026-11-11", "Groceries");
    await s.enter("ZZ P", "2026-11-12", "Fun");
    const id = (await s.payee("ZZ P")).id;
    // A 3-way tie keeps the stored Rent.
    expect(await s.nameIs("ZZ P")).toBe("Rent");
    await send(`${P(s.bid)}/${id}`, "PATCH", {
      category_mode: "fixed",
      fixed_category_id: s.ids.Rent,
    });
    await env.DB.prepare("update categories set deleted_at = '2026-11-20' where id = ?")
      .bind(s.ids.Rent)
      .run();
    expect((await s.payee("ZZ P")).default_category_id).toBeNull();
    await send(`${P(s.bid)}/${id}`, "PATCH", { category_mode: "history" });
    await env.DB.prepare("update categories set deleted_at = '2026-11-20' where id = ?")
      .bind(s.ids.Fun)
      .run();
    // Fun is gone, so the stored value is not live: the read-time rule takes the most recent counted value.
    expect((await s.payee("ZZ P")).default_category_id).toBe(s.ids.Groceries);
  });

  it("none of these writes bumps payees.updated_at or adds a payee change_log row", async () => {
    const s = await world();
    const a = await s.enter("ZZ P", "2026-11-10", "Fun");
    const before = await s.stored("ZZ P");
    const logsBefore = await s.payeeLogs();
    await s.patchTx(a.id, { category_id: s.ids.Groceries });
    await s.enter("ZZ P", "2026-11-11", "Groceries");
    await send(`/api/v1/budgets/${s.bid}/transactions/${a.id}`, "DELETE");
    const after = await s.stored("ZZ P");
    expect(after.default_category_id).toBe(s.ids.Groceries);
    expect(after.updated_at).toBe(before.updated_at);
    expect(await s.payeeLogs()).toBe(logsBefore);
  });
});
