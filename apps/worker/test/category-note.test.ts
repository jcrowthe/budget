import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { actor, api, cat, type Json, logs, mcp, month, plan, send } from "./category-helpers";
import { listedToolNames } from "./surface";

const NOV = "2026-11-01";
const DEC = "2026-12-01";

async function seed() {
  const bid = await plan();
  const m = await month(bid, NOV);
  const c = cat(m, "🛒 Groceries");
  const patch = (body: unknown) => send("PATCH", api(bid, `/categories/${c.id}`), body);
  const stored = async () =>
    (
      await env.DB.prepare("select note from categories where id = ?")
        .bind(c.id)
        .first<{ note: string | null }>()
    )?.note;
  return { bid, c, patch, stored };
}

describe("category note", () => {
  it("stores a multi-line note and the month read carries it in every month", async () => {
    const s = await seed();
    const res = await s.patch({ note: "a\nb" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.category.note).toBe("a\nb");
    expect(await s.stored()).toBe("a\nb");
    for (const m of [NOV, DEC]) expect(cat(await month(s.bid, m), s.c.name).note).toBe("a\nb");
    expect(cat(await month(s.bid, NOV), "🏠 Rent/Mortgage").note).toBeNull();
  });

  it("trims the ends; blank and null clear it; too long is 422", async () => {
    const s = await seed();
    await s.patch({ note: "  keep\ninside  " });
    expect(await s.stored()).toBe("keep\ninside");
    await s.patch({ note: "  " });
    expect(await s.stored()).toBeNull();
    await s.patch({ note: "x" });
    await s.patch({ note: null });
    expect(await s.stored()).toBeNull();
    expect((await s.patch({ note: "x".repeat(5001) })).status).toBe(422);
    expect((await s.patch({ note: "x".repeat(5000) })).status).toBe(200);
  });

  it("writes one change_log row per change with the actor and the before and after note", async () => {
    const s = await seed();
    await s.patch({ note: "one" });
    await s.patch({ note: "one" }); // no change, no row
    const viaMcp = await mcp("set_category_note", {
      budget_id: s.bid,
      category_id: s.c.id,
      note: "two",
    });
    expect(viaMcp.structuredContent.category).toMatchObject({ id: s.c.id, note: "two" });
    const rows = (await logs(s.bid, "category")).filter(
      (l) => l.entity_id === s.c.id && l.action === "update",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.actor).toBe(actor);
    expect(rows[1]?.actor.startsWith("mcp:")).toBe(true);
    expect(JSON.parse(rows[0]?.before_json ?? "{}").note).toBeNull();
    expect(JSON.parse(rows[0]?.after_json ?? "{}").note).toBe("one");
    expect(JSON.parse(rows[1]?.before_json ?? "{}").note).toBe("one");
    expect(JSON.parse(rows[1]?.after_json ?? "{}").note).toBe("two");
  });

  it("set_category_note clears with null and agrees with the REST value", async () => {
    const s = await seed();
    const rest = ((await (await s.patch({ note: "same" })).json()) as Json).data.category;
    const other = cat(await month(s.bid, NOV), "🏠 Rent/Mortgage");
    const viaMcp = (
      await mcp("set_category_note", { budget_id: s.bid, category_id: other.id, note: "same" })
    ).structuredContent.category;
    expect(viaMcp).toMatchObject({ ...rest, id: other.id, group_id: expect.any(String), name: other.name, sort: other.sort });
    const cleared = await mcp("set_category_note", {
      budget_id: s.bid,
      category_id: other.id,
      note: null,
    });
    expect(cleared.structuredContent.category.note).toBeNull();
  });

  it("is atomic: a failing change_log insert leaves the note unchanged", async () => {
    const s = await seed();
    await env.DB.exec(
      "CREATE TRIGGER zz_fail_log BEFORE INSERT ON change_log WHEN NEW.entity_type = 'category' BEGIN SELECT RAISE(ABORT, 'no log'); END",
    );
    try {
      const res = await s.patch({ note: "lost" });
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await env.DB.exec("DROP TRIGGER zz_fail_log");
    }
    expect(await s.stored()).toBeNull();
  });

  it("rename and hide keep the note", async () => {
    const s = await seed();
    await s.patch({ note: "stay" });
    await s.patch({ name: "Food" });
    await s.patch({ hidden: true });
    await s.patch({ hidden: false });
    expect(await s.stored()).toBe("stay");
  });

  it("has a tool", async () => {
    expect(await listedToolNames()).toContain("set_category_note");
  });
});
