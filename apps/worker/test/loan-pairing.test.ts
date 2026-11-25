import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Json } from "./bulk-helpers";
import { json } from "./helpers";
import { makeCategory, newPlan, openAccount, send, tool, world } from "./loan-world";
import { setOf, undo } from "./undo-helpers";

// EXF-541: PUT .../accounts/{id}/paired-category and pair_loan_category.
const put = (bid: string, loan: string, category_id: string) =>
  send(`/api/v1/budgets/${bid}/accounts/${loan}/paired-category`, "PUT", { category_id });
const paired = async (bid: string, id: string) =>
  ((await (await json(`/api/v1/budgets/${bid}/accounts/${id}`)).json()) as Json).data.account
    .paired_category_id;
const logs = async (bid: string, id: string) =>
  (
    await env.DB.prepare(
      "select actor, action, before_json, after_json from change_log where budget_id = ? and entity_type = 'account' and entity_id = ? and action = 'update'",
    )
      .bind(bid, id)
      .all<{ actor: string; before_json: string; after_json: string }>()
  ).results;

describe("pair a loan with a category", () => {
  it("pairs, logs the change and undoes it", async () => {
    const w = await world(false);
    const cat = await makeCategory(w.bid);
    expect(await paired(w.bid, w.auto.id)).toBeNull();
    const res = await put(w.bid, w.auto.id, cat.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.account.paired_category_id).toBe(cat.id);
    expect(await paired(w.bid, w.auto.id)).toBe(cat.id);
    const rows = await logs(w.bid, w.auto.id);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.before_json ?? "{}").paired_category_id).toBeNull();
    expect(JSON.parse(rows[0]?.after_json ?? "{}").paired_category_id).toBe(cat.id);
    expect(rows[0]?.actor).toBeTruthy();
    const u = await undo(w.bid, setOf(res));
    expect(u.status).toBe(200);
    expect(await paired(w.bid, w.auto.id)).toBeNull();
  });
  it("re-pairs a paired loan", async () => {
    const w = await world(true);
    const cat = await makeCategory(w.bid);
    expect((await put(w.bid, w.mortgage.id, cat.id)).status).toBe(200);
    expect(await paired(w.bid, w.mortgage.id)).toBe(cat.id);
  });
  it("refuses with nothing written", async () => {
    const w = await world(false);
    const before = await logs(w.bid, w.auto.id);
    const refuse = async (id: string, loan = w.auto.id, name = "unprocessable_entity") => {
      const r = await put(w.bid, loan, id);
      expect(r.status).toBe(422);
      expect(((await r.json()) as Json).error.name).toBe(name);
      expect(await paired(w.bid, loan)).toBeNull();
    };
    const hidden = await makeCategory(w.bid);
    await env.DB.prepare("update categories set hidden = 1 where id = ?").bind(hidden.id).run();
    await refuse(hidden.id);
    const deleted = await makeCategory(w.bid);
    await env.DB.prepare("update categories set deleted_at = ? where id = ?")
      .bind(new Date().toISOString(), deleted.id)
      .run();
    await refuse(deleted.id);
    const card = await openAccount(w.bid, { name: "Card", type: "creditCard", balance: 0 });
    const pay = (await env.DB.prepare(
      "select id from categories where budget_id = ? and kind is not null and deleted_at is null",
    )
      .bind(w.bid)
      .first<{ id: string }>()) as { id: string };
    expect(card.id).toBeTruthy();
    await refuse(pay.id);
    const other = await newPlan();
    const foreign = await makeCategory(other);
    await refuse(foreign.id);
    await refuse(hidden.id, w.checking.id, "not_a_loan_account");
    expect(await logs(w.bid, w.auto.id)).toEqual(before);
    const ok = await makeCategory(w.bid);
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(w.auto.id).run();
    await refuse(ok.id, w.auto.id, "account_closed");
    expect((await put(w.bid, "nope", ok.id)).status).toBe(404);
  });
  it("MCP does the same, and a refusal is a tool error", async () => {
    const w = await world(false);
    const cat = await makeCategory(w.bid);
    const r = await tool("pair_loan_category", {
      budget_id: w.bid,
      loan_account_id: w.auto.id,
      category_id: cat.id,
    });
    expect(r.isError).toBeFalsy();
    expect(await paired(w.bid, w.auto.id)).toBe(cat.id);
    const bad = await tool("pair_loan_category", {
      budget_id: w.bid,
      loan_account_id: w.checking.id,
      category_id: cat.id,
    });
    expect(bad.isError).toBe(true);
  });
});
