import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { idList } from "../src/repositories/guards";
import { deleteCategoryGroup, groupUsage } from "../src/services/category-delete";
import { type BigGroup, causeOf, seedBigGroup } from "./bound-lists-helpers";
import { actor, api, type Json, send } from "./category-helpers";

const delGroup = (s: BigGroup, to?: string) =>
  send("DELETE", api(s.bid, `/category_groups/${s.groupId}${to ? `?reassign_to=${to}` : ""}`));

async function expectStatus(res: Response, status: number, s: BigGroup, reassign?: string) {
  if (res.status !== status) {
    const cause = await causeOf(() =>
      deleteCategoryGroup(env, actor, {
        budget_id: s.bid,
        group_id: s.groupId,
        reassign_to: reassign,
      }),
    );
    expect.fail(`status ${res.status}, wanted ${status}: ${cause}`);
  }
}

async function deletedCount(s: BigGroup) {
  const r = await env.DB.prepare(
    "select count(*) n from categories where group_id = ? and deleted_at is not null",
  )
    .bind(s.groupId)
    .first<{ n: number }>();
  return r?.n;
}

describe("EXF-883: a group's categories as one parameter", () => {
  it("A1: deletes a group of 35 categories without history", async () => {
    const s = await seedBigGroup(35);
    const res = await delGroup(s);
    await expectStatus(res, 200, s);
    const d = ((await res.json()) as Json).data.deleted;
    expect(d.category_ids).toHaveLength(35);
    expect(await deletedCount(s)).toBe(35);
    const g = await env.DB.prepare("select deleted_at from category_groups where id = ?")
      .bind(s.groupId)
      .first<{ deleted_at: string | null }>();
    expect(g?.deleted_at).not.toBeNull();
  });

  it("A2: deletes a group of 35 with history and reassign_to", async () => {
    const s = await seedBigGroup(35, { history: true });
    const res = await delGroup(s, s.targetId);
    await expectStatus(res, 200, s, s.targetId);
    expect(((await res.json()) as Json).data.deleted.transactions_moved).toBe(1);
  });

  it("A3: deletes a group of 45 with history and reassign_to", async () => {
    const s = await seedBigGroup(45, { history: true });
    const res = await delGroup(s, s.targetId);
    await expectStatus(res, 200, s, s.targetId);
    expect(((await res.json()) as Json).data.deleted.transactions_moved).toBe(1);
  });

  it("A4: reads the usage of a group of 55", async () => {
    const s = await seedBigGroup(55);
    const res = await send("GET", api(s.bid, `/category_groups/${s.groupId}/usage`));
    if (res.status !== 200) {
      expect.fail(
        `status ${res.status}: ${await causeOf(() => groupUsage(env, s.bid, s.groupId))}`,
      );
    }
    expect(((await res.json()) as Json).data).toMatchObject({
      category_count: 55,
      transaction_count: 0,
      has_history: false,
    });
  });

  it("A5: refuses a group of 55 with history and no reassign_to with 409", async () => {
    const s = await seedBigGroup(55, { history: true });
    const res = await delGroup(s);
    await expectStatus(res, 409, s);
    expect(((await res.json()) as Json).error.name).toBe("history_exists");
  });

  it("A6: handles a group of 120", async () => {
    const a = await seedBigGroup(120);
    const usage = await send("GET", api(a.bid, `/category_groups/${a.groupId}/usage`));
    await expectStatus(usage, 200, a);
    const res = await delGroup(a);
    await expectStatus(res, 200, a);
    expect(((await res.json()) as Json).data.deleted.category_ids).toHaveLength(120);
    expect(await deletedCount(a)).toBe(120);
    const rows = await env.DB.prepare(
      "select entity_type, count(*) n from change_log where budget_id = ? and action = 'delete' group by entity_type",
    )
      .bind(a.bid)
      .all<{ entity_type: string; n: number }>();
    const by = Object.fromEntries(rows.results.map((r) => [r.entity_type, r.n]));
    expect(by.category).toBe(120);
    expect(by.category_group).toBe(1);

    const b = await seedBigGroup(120, { history: true });
    const res2 = await delGroup(b, b.targetId);
    await expectStatus(res2, 200, b, b.targetId);
    expect(((await res2.json()) as Json).data.deleted.transactions_moved).toBe(1);
    expect(await deletedCount(b)).toBe(120);
  });

  it("A7: idList binds one parameter", async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `id-${i}`);
    ids[499] = "x";
    const rows = await getDb(env).all<{ n: number }>(
      sql`select count(*) n from (select 'x' v) where v in (${idList(ids)})`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});
