import { describe, expect, it } from "vitest";
import {
  actor,
  api,
  cat,
  group,
  type Json,
  logs,
  mcp,
  month,
  plan,
  send,
} from "./category-helpers";
import { apiPaths, listedToolNames } from "./surface";

const NOV = "2026-11-01";

describe("categories", () => {
  it("POST goes to the top of the group; duplicates only clash within the group", async () => {
    const bid = await plan();
    const m = await month(bid, NOV);
    const bills = group(m, "Bills");
    const needs = group(m, "Needs");
    const res = await send("POST", api(bid, "/categories"), {
      group_id: bills.id,
      name: " ZZ Cat ",
    });
    expect(res.status).toBe(201);
    const c = ((await res.json()) as Json).data.category;
    expect(c).toMatchObject({ name: "ZZ Cat", group_id: bills.id, hidden: false });
    expect(c.sort).toBeLessThan(Math.min(...bills.categories.map((x) => x.sort)));
    expect(group(await month(bid, NOV), "Bills").categories[0]?.id).toBe(c.id);
    const log = (await logs(bid, "category")).filter((l) => l.entity_id === c.id);
    expect(log).toMatchObject([{ action: "create", actor }]);

    const dup = await send("POST", api(bid, "/categories"), { group_id: bills.id, name: "zz cat" });
    expect(dup.status).toBe(422);
    expect(((await dup.json()) as Json).error).toMatchObject({
      name: "name_taken",
      detail: "A category with this name already exists in this group",
    });
    expect(
      (await send("POST", api(bid, "/categories"), { group_id: needs.id, name: "zz cat" })).status,
    ).toBe(201);
    const empty = await send("POST", api(bid, "/categories"), { group_id: bills.id, name: " " });
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as Json).error.detail).toBe("The category name is required.");
    expect(
      (await send("POST", api(bid, "/categories"), { group_id: crypto.randomUUID(), name: "q" }))
        .status,
    ).toBe(404);
    expect(
      (await send("POST", api(bid, "/categories"), { group_id: "nope", name: "q" })).status,
    ).toBe(404);
    const other = await plan();
    const foreign = group(await month(other, NOV), "Bills");
    expect(
      (await send("POST", api(bid, "/categories"), { group_id: foreign.id, name: "q" })).status,
    ).toBe(404);
  });

  it("an empty group takes its first category at 0", async () => {
    const bid = await plan();
    const g = (
      (await (await send("POST", api(bid, "/category_groups"), { name: "Empty" })).json()) as Json
    ).data.category_group;
    const c = (
      (await (
        await send("POST", api(bid, "/categories"), { group_id: g.id, name: "One" })
      ).json()) as Json
    ).data.category;
    expect(c.sort).toBe(0);
  });

  it("PATCH renames with the same rules", async () => {
    const bid = await plan();
    const m = await month(bid, NOV);
    const rent = cat(m, "🏠 Rent/Mortgage");
    const url = api(bid, `/categories/${rent.id}`);
    const ok = await send("PATCH", url, { name: "D1 Rent 🏡" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Json).data.category.name).toBe("D1 Rent 🏡");
    expect((await send("PATCH", url, { name: "d1 rent 🏡" })).status).toBe(200);
    const dup = await send("PATCH", url, { name: "📱 phone & internet" });
    expect(dup.status).toBe(422);
    expect(((await dup.json()) as Json).error.name).toBe("name_taken");
    const empty = await send("PATCH", url, { name: "" });
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as Json).error.detail).toBe("The category name is required.");
    expect((await send("PATCH", url, {})).status).toBe(422);
    expect(
      (await send("PATCH", api(bid, `/categories/${crypto.randomUUID()}`), { name: "x" })).status,
    ).toBe(404);
    const log = (await logs(bid, "category")).filter(
      (l) => l.entity_id === rent.id && l.action === "update",
    );
    expect(log).toHaveLength(2);
    expect(JSON.parse(log[0]?.before_json ?? "{}").name).toBe("🏠 Rent/Mortgage");
  });

  it("MCP create_category and rename_category equal REST", async () => {
    const bid = await plan();
    const bills = group(await month(bid, NOV), "Bills");
    const rest = (
      (await (
        await send("POST", api(bid, "/categories"), { group_id: bills.id, name: "R" })
      ).json()) as Json
    ).data.category;
    const viaMcp = (await mcp("create_category", { budget_id: bid, group_id: bills.id, name: "M" }))
      .structuredContent.category;
    const strip = ({ id, name, sort, ...rest }: Json) => rest;
    expect(strip(viaMcp)).toEqual(strip(rest));
    const renamed = (
      await mcp("rename_category", { budget_id: bid, category_id: viaMcp.id, name: "M2" })
    ).structuredContent.category;
    expect(renamed).toMatchObject({ id: viaMcp.id, name: "M2" });
    const rows = (await logs(bid, "category")).filter((l) => l.entity_id === viaMcp.id);
    expect(rows.map((r) => r.actor.startsWith("mcp:"))).toEqual([true, true]);
  });

  it("lists its paths and tools", async () => {
    const paths = await apiPaths();
    for (const p of [
      "/api/v1/budgets/{budget_id}/categories",
      "/api/v1/budgets/{budget_id}/categories/unhide_all",
      "/api/v1/budgets/{budget_id}/categories/{category_id}",
      "/api/v1/budgets/{budget_id}/categories/{category_id}/usage",
    ]) {
      expect(paths).toContain(p);
    }
    const tools = await listedToolNames();
    for (const t of [
      "create_category",
      "rename_category",
      "set_category_hidden",
      "delete_category",
    ]) {
      expect(tools).toContain(t);
    }
  });
});
