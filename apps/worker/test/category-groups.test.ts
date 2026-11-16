import { describe, expect, it } from "vitest";
import { tools as categoryTools } from "../src/mcp/tools/categories";
import { tools as groupTools } from "../src/mcp/tools/category-groups";
import { actor, api, group, type Json, logs, mcp, month, plan, send } from "./category-helpers";
import { apiPaths, listedToolNames } from "./surface";

const NOV = "2026-11-01";

describe("category groups", () => {
  it("POST puts the group first, logs create, and refuses empty and duplicate names", async () => {
    const bid = await plan();
    const before = await month(bid, NOV);
    const res = await send("POST", api(bid, "/category_groups"), { name: "  ZZ Group " });
    expect(res.status).toBe(201);
    const created = ((await res.json()) as Json).data.category_group;
    expect(created.name).toBe("ZZ Group");
    expect(created.sort).toBeLessThan(Math.min(...before.groups.map((g) => g.sort)));
    const after = await month(bid, NOV);
    expect(after.groups[0]?.id).toBe(created.id);
    expect(after.groups).toHaveLength(4);
    const log = (await logs(bid, "category_group")).filter((l) => l.entity_id === created.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "create", actor });

    const empty = await send("POST", api(bid, "/category_groups"), { name: "   " });
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as Json).error.detail).toBe("The group name is required.");
    const dup = await send("POST", api(bid, "/category_groups"), { name: " bills " });
    expect(dup.status).toBe(422);
    expect(((await dup.json()) as Json).error).toMatchObject({
      name: "name_taken",
      detail: "This group name already exists",
    });
    expect(
      (await send("POST", api(crypto.randomUUID(), "/category_groups"), { name: "x" })).status,
    ).toBe(404);
  });

  it("reuses the name of a deleted group", async () => {
    const bid = await plan();
    const g = group(await month(bid, NOV), "Wants");
    expect((await send("DELETE", api(bid, `/category_groups/${g.id}`))).status).toBe(200);
    expect((await send("POST", api(bid, "/category_groups"), { name: "Wants" })).status).toBe(201);
  });

  it("PATCH renames (emoji kept, own name in another case allowed) and collapses without a log row", async () => {
    const bid = await plan();
    const g = group(await month(bid, NOV), "Needs");
    const url = api(bid, `/category_groups/${g.id}`);
    const r = await send("PATCH", url, { name: "Needs 🏡" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as Json).data.category_group.name).toBe("Needs 🏡");
    expect((await send("PATCH", url, { name: "NEEDS 🏡" })).status).toBe(200);
    const clash = await send("PATCH", url, { name: "bills" });
    expect(clash.status).toBe(422);

    const n = (await logs(bid, "category_group")).length;
    expect((await send("PATCH", url, { collapsed: true })).status).toBe(200);
    expect(group(await month(bid, NOV), "NEEDS 🏡").collapsed).toBe(true);
    expect((await logs(bid, "category_group")).length).toBe(n);
    expect((await send("PATCH", url, { collapsed: false })).status).toBe(200);
    expect((await logs(bid, "category_group")).length).toBe(n);

    expect((await send("PATCH", url, {})).status).toBe(422);
    expect(
      (await send("PATCH", api(bid, `/category_groups/${crypto.randomUUID()}`), { name: "x" }))
        .status,
    ).toBe(404);
    expect((await send("PATCH", api(bid, "/category_groups/nope"), { name: "x" })).status).toBe(
      404,
    );
  });

  it("MCP tools return the REST shapes and log the mcp actor", async () => {
    const bid = await plan();
    const created = await mcp("create_category_group", { budget_id: bid, name: "Via MCP" });
    const g = created.structuredContent.category_group;
    expect(g).toMatchObject({ name: "Via MCP", hidden: false, collapsed: false });
    const renamed = await mcp("rename_category_group", {
      budget_id: bid,
      group_id: g.id,
      name: "Via MCP 2",
    });
    expect(renamed.structuredContent.category_group.name).toBe("Via MCP 2");
    const hidden = await mcp("set_category_group_hidden", {
      budget_id: bid,
      group_id: g.id,
      hidden: true,
    });
    expect(hidden.structuredContent.category_group.hidden).toBe(true);
    const rows = (await logs(bid, "category_group")).filter((l) => l.entity_id === g.id);
    expect(rows.map((r) => r.action)).toEqual(["create", "update", "update"]);
    for (const r of rows) expect(r.actor.startsWith("mcp:")).toBe(true);
  });

  it("lists its paths and tools", async () => {
    const paths = await apiPaths();
    for (const p of [
      "/api/v1/budgets/{budget_id}/category_groups",
      "/api/v1/budgets/{budget_id}/category_groups/{group_id}",
      "/api/v1/budgets/{budget_id}/category_groups/{group_id}/usage",
    ]) {
      expect(paths).toContain(p);
    }
    const tools = await listedToolNames();
    for (const t of [
      "create_category_group",
      "rename_category_group",
      "set_category_group_hidden",
      "delete_category_group",
      "get_category_group_usage",
    ]) {
      expect(tools).toContain(t);
    }
  });
});

describe("category tools share one contract", () => {
  it("validate budget_id the same way and say what they return", () => {
    const all = [...categoryTools, ...groupTools];
    expect(all).toHaveLength(12);
    for (const t of all) {
      const shape = (
        t.inputSchema as unknown as {
          shape: Record<string, { safeParse(v: unknown): { success: boolean } }>;
        }
      ).shape;
      expect(shape.budget_id?.safeParse("").success, t.name).toBe(false);
      expect(shape.budget_id?.safeParse("x").success, t.name).toBe(true);
      expect(t.description, t.name).toContain("Returns");
    }
  });
});
