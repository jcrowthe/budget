import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { actor, api, type Json, send } from "./category-helpers";
import { account, plan, q, sched } from "./scheduled-helpers";
import { setOf, undo } from "./undo-helpers";

async function seed() {
  const bid = await plan();
  const acc = await account(bid);
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "G" });
  const mk = async (name: string) =>
    (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name })).id;
  const a = await mk("A");
  const b = await mk("B");
  const c = await mk("C");
  const s = (
    await sched(bid, {
      account_id: acc,
      date_first: "2026-12-01",
      frequency: "monthly",
      amount: -40000,
      subtransactions: [
        { amount: -30000, category_id: a },
        { amount: -10000, category_id: c },
      ],
    })
  ).scheduled_transaction;
  return { bid, acc, a, b, c, id: s.id as string, line: s.subtransactions[0].id as string };
}
const lineCats = (id: string) =>
  q(
    "select category_id from scheduled_subtransactions where scheduled_transaction_id = ? and deleted_at is null order by sort",
    id,
  ).then((r) => r.map((x) => x.category_id));

describe("category delete moves the lines of split schedules (EXF-659)", () => {
  it("the preview counts a schedule whose line uses the category", async () => {
    const s = await seed();
    const usage = await send("GET", api(s.bid, `/categories/${s.a}/usage`));
    expect(((await usage.json()) as Json).data.usage.scheduled_count).toBe(1);
  });

  it("with a replacement the line moves, logged, and undo puts it back", async () => {
    const s = await seed();
    const res = await send("DELETE", api(s.bid, `/categories/${s.a}?reassign_to=${s.b}`));
    expect(res.status).toBe(200);
    expect(await lineCats(s.id)).toEqual([s.b, s.c]);
    const log = await q(
      "select action from change_log where entity_id = ? and entity_type = 'scheduled_subtransaction'",
      s.line,
    );
    expect(log).toEqual([{ action: "update" }]);
    const r = await undo(s.bid, setOf(res));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await lineCats(s.id)).toEqual([s.a, s.c]);
  });

  it("without a replacement the line is cleared", async () => {
    const s = await seed();
    expect((await send("DELETE", api(s.bid, `/categories/${s.a}`))).status).toBe(200);
    expect(await lineCats(s.id)).toEqual([null, s.c]);
  });

  it("a line of a deleted schedule is neither counted nor moved", async () => {
    const s = await seed();
    expect((await send("DELETE", api(s.bid, `/scheduled-transactions/${s.id}`))).status).toBe(200);
    const usage = await send("GET", api(s.bid, `/categories/${s.a}/usage`));
    expect(((await usage.json()) as Json).data.usage.scheduled_count).toBe(0);
    expect((await send("DELETE", api(s.bid, `/categories/${s.a}?reassign_to=${s.b}`))).status).toBe(
      200,
    );
    expect(await lineCats(s.id)).toEqual([s.a, s.c]);
  });
});
