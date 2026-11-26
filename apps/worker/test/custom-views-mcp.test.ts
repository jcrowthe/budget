import { describe, expect, it } from "vitest";
import { type Json, plan, q, tool as rpc, send } from "./bulk-helpers";
import { createView, listViews, planCategories, views } from "./custom-views-helpers";

const tool = async (name: string, args: unknown): Promise<Json> => (await rpc(name, args)).result;
const strip = (v: Json) => {
  const { id: _i, created_at: _c, updated_at: _u, ...rest } = v;
  return rest;
};
const text = (r: Json) => JSON.stringify(r.content ?? r);

describe("custom views: REST = MCP", () => {
  it("list_views answers what GET answers", async () => {
    const b = await plan();
    const [a] = await planCategories(b);
    await createView(b, "ZZ one", [a?.id as string]);
    const rest = await listViews(b);
    const mcp = await tool("list_views", { budget_id: b });
    expect(mcp.isError).toBeFalsy();
    expect(mcp.structuredContent).toEqual(rest);
  });

  it("create, update, delete and reorder give the REST data", async () => {
    const b1 = await plan();
    const b2 = await plan();
    const [a1, c1] = await planCategories(b1);
    const [a2, c2] = await planCategories(b2);
    // the same inputs through each surface (same seed, so the same category ids by position)
    const restMade = await createView(b1, " ZZ one ", [a1?.id as string, c1?.id as string]);
    const mcpMade = (
      await tool("create_view", {
        budget_id: b2,
        name: " ZZ one ",
        category_ids: [a2?.id, c2?.id],
      })
    ).structuredContent.view;
    expect(strip(mcpMade)).toEqual({ ...strip(restMade), category_ids: [a2?.id, c2?.id] });

    const restUpd = (
      (await (await send(views(b1, `/${restMade.id}`), "PATCH", { name: "ZZ two" })).json()) as Json
    ).data.view;
    const mcpUpd = (
      await tool("update_view", { budget_id: b2, view_id: mcpMade.id, name: "ZZ two" })
    ).structuredContent.view;
    expect(strip(mcpUpd)).toEqual({ ...strip(restUpd), category_ids: [a2?.id, c2?.id] });

    const order = (id: string) => [id, "snoozed", "underfunded", "overfunded", "money_available"];
    const restOrder = (
      (await (
        await send(views(b1, "/reorder"), "POST", { ids: order(restMade.id) })
      ).json()) as Json
    ).data;
    const mcpOrder = (await tool("reorder_views", { budget_id: b2, ids: order(mcpMade.id) }))
      .structuredContent;
    expect(mcpOrder.order).toEqual(order(mcpMade.id));
    expect(restOrder.order).toEqual(order(restMade.id));
    expect(mcpOrder.views.map(strip)).toEqual(
      restOrder.views.map((v: Json) => ({ ...strip(v), category_ids: [a2?.id, c2?.id] })),
    );

    const restDel = ((await (await send(views(b1, `/${restMade.id}`), "DELETE")).json()) as Json)
      .data.view;
    const mcpDel = (await tool("delete_view", { budget_id: b2, view_id: mcpMade.id }))
      .structuredContent.view;
    expect(strip(mcpDel)).toEqual({ ...strip(restDel), category_ids: [a2?.id, c2?.id] });
    expect(await listViews(b2)).toEqual(await listViews(b1));
  });

  it("the change_log actor is MCP", async () => {
    const b = await plan();
    const made = (await tool("create_view", { budget_id: b, name: "ZZ" })).structuredContent.view;
    await tool("update_view", { budget_id: b, view_id: made.id, name: "ZZ two" });
    await tool("reorder_views", {
      budget_id: b,
      ids: [made.id, "underfunded", "overfunded", "money_available", "snoozed"],
    });
    await tool("delete_view", { budget_id: b, view_id: made.id });
    const rows = await q(
      "select actor, entity_type from change_log where budget_id = ? and entity_type like 'plan_view%' order by rowid",
      b,
    );
    expect(rows.map((r) => r.entity_type)).toEqual([
      "plan_view",
      "plan_view",
      "plan_view_order",
      "plan_view",
    ]);
    expect(rows.every((r) => String(r.actor).startsWith("mcp:"))).toBe(true);
  });

  it("validation is a tool error with the REST message", async () => {
    const b = await plan();
    const made = (await tool("create_view", { budget_id: b, name: "ZZ" })).structuredContent.view;
    const blank = await tool("create_view", { budget_id: b, name: "  " });
    expect(blank.isError).toBe(true);
    expect(text(blank)).toContain("The view name is required.");
    const built = await tool("update_view", { budget_id: b, view_id: "snoozed", name: "x" });
    expect(built.isError).toBe(true);
    expect(text(built)).toContain("Built-in views can only be reordered.");
    const del = await tool("delete_view", { budget_id: b, view_id: "underfunded" });
    expect(del.isError).toBe(true);
    expect(text(del)).toContain("Built-in views can only be reordered.");
    const bad = await tool("reorder_views", { budget_id: b, ids: [made.id] });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("ids must list every view exactly once.");
    const unknown = await tool("create_view", { budget_id: b, name: "x", category_ids: ["nope"] });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain("Category not found");
  });
});
