import { describe, expect, it } from "vitest";
import { type Json, plan, q, send } from "./bulk-helpers";
import { BUILTINS, createView, listViews, planCategories, views } from "./custom-views-helpers";
import { setOf, undo } from "./undo-helpers";

const err = async (res: Response) => ((await res.json()) as Json).error.detail as string;
const viewLogs = (bid: string, type = "plan_view") =>
  q(
    "select action, entity_id, actor, before_json, after_json from change_log where budget_id = ? and entity_type = ? order by rowid",
    bid,
    type,
  );

describe("custom views: create", () => {
  it("201, trimmed name, zero categories allowed", async () => {
    const b = await plan();
    const res = await send(views(b), "POST", { name: "  ZZ-TEST Bills  " });
    expect(res.status).toBe(201);
    const v = ((await res.json()) as Json).data.view;
    expect(v).toMatchObject({ name: "ZZ-TEST Bills", category_ids: [] });
    expect(typeof v.id).toBe("string");
  });
  it("blank names and 101 characters are 422", async () => {
    const b = await plan();
    for (const name of ["", "   "]) {
      const res = await send(views(b), "POST", { name });
      expect(res.status).toBe(422);
      expect(await err(res)).toContain("The view name is required.");
    }
    expect((await send(views(b), "POST", { name: "x".repeat(101) })).status).toBe(422);
    expect((await send(views(b), "POST", {})).status).toBe(422);
    expect((await listViews(b)).views).toEqual([]);
  });
  it("an unknown or another plan's category is 404 and nothing is written", async () => {
    const b = await plan();
    const other = await plan();
    const [mine] = await planCategories(b);
    const [theirs] = await planCategories(other);
    expect((await send(views(b), "POST", { name: "ZZ", category_ids: ["nope"] })).status).toBe(404);
    const res = await send(views(b), "POST", { name: "ZZ", category_ids: [mine?.id, theirs?.id] });
    expect(res.status).toBe(404);
    expect(await err(res)).toBe("Category not found");
    expect((await listViews(b)).views).toEqual([]);
    expect(await viewLogs(b)).toEqual([]);
  });
  it("duplicate ids are stored once; a hidden category is accepted", async () => {
    const b = await plan();
    const [a, c] = await planCategories(b);
    await send(`/api/v1/budgets/${b}/categories/${c?.id}`, "PATCH", { hidden: true });
    const v = await createView(b, "ZZ", [a?.id as string, a?.id as string, c?.id as string]);
    expect(v.category_ids).toEqual([a?.id, c?.id]);
  });
});

describe("custom views: list", () => {
  it("a new plan lists the built-ins; customs follow in creation order", async () => {
    const b = await plan();
    expect(await listViews(b)).toEqual({ order: BUILTINS, views: [] });
    const one = await createView(b, "ZZ one");
    const two = await createView(b, "ZZ two");
    const l = await listViews(b);
    expect(l.order).toEqual([...BUILTINS, one.id, two.id]);
    expect(l.views.map((v: Json) => v.name)).toEqual(["ZZ one", "ZZ two"]);
  });
  it("is per plan", async () => {
    const b = await plan();
    await createView(b, "ZZ one");
    expect((await listViews(await plan())).views).toEqual([]);
  });
  it("an unknown plan is 404", async () => {
    expect((await send(views("nope"), "GET")).status).toBe(404);
  });
});

describe("custom views: update", () => {
  it("renames alone, or replaces the categories alone", async () => {
    const b = await plan();
    const [a, c] = await planCategories(b);
    const v = await createView(b, "ZZ one", [a?.id as string]);
    let res = await send(views(b, `/${v.id}`), "PATCH", { name: " ZZ renamed " });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.view).toMatchObject({
      name: "ZZ renamed",
      category_ids: [a?.id],
    });
    res = await send(views(b, `/${v.id}`), "PATCH", { category_ids: [c?.id] });
    expect(((await res.json()) as Json).data.view).toMatchObject({
      name: "ZZ renamed",
      category_ids: [c?.id],
    });
    res = await send(views(b, `/${v.id}`), "PATCH", { category_ids: [] });
    expect(((await res.json()) as Json).data.view.category_ids).toEqual([]);
  });
  it("an empty body is 422", async () => {
    const b = await plan();
    const v = await createView(b, "ZZ");
    expect((await send(views(b, `/${v.id}`), "PATCH", {})).status).toBe(422);
    expect((await send(views(b, `/${v.id}`), "PATCH", { name: " " })).status).toBe(422);
  });
  it("a built-in key is 422 with no change_log row", async () => {
    const b = await plan();
    const res = await send(views(b, "/underfunded"), "PATCH", { name: "x" });
    expect(res.status).toBe(422);
    expect(await err(res)).toBe("Built-in views can only be reordered.");
    expect(await viewLogs(b)).toEqual([]);
  });
  it("an unknown, another plan's or a deleted id is 404", async () => {
    const b = await plan();
    const other = await plan();
    const theirs = await createView(other, "ZZ theirs");
    const gone = await createView(b, "ZZ gone");
    await send(views(b, `/${gone.id}`), "DELETE");
    for (const id of ["nope", theirs.id, gone.id]) {
      expect((await send(views(b, `/${id}`), "PATCH", { name: "x" })).status).toBe(404);
    }
  });
  it("an unknown category is 404 and the view is unchanged", async () => {
    const b = await plan();
    const v = await createView(b, "ZZ");
    expect((await send(views(b, `/${v.id}`), "PATCH", { category_ids: ["nope"] })).status).toBe(
      404,
    );
    expect((await listViews(b)).views[0].category_ids).toEqual([]);
  });
});

describe("custom views: delete", () => {
  it("removes the view from views and order and soft-deletes the row", async () => {
    const b = await plan();
    const v = await createView(b, "ZZ one");
    const res = await send(views(b, `/${v.id}`), "DELETE");
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.view.id).toBe(v.id);
    expect(await listViews(b)).toEqual({ order: BUILTINS, views: [] });
    const row = (await q("select deleted_at from plan_views where id = ?", v.id))[0];
    expect(row?.deleted_at).not.toBeNull();
    expect((await send(views(b, `/${v.id}`), "DELETE")).status).toBe(404);
  });
  it("a built-in key is 422", async () => {
    const b = await plan();
    const res = await send(views(b, "/snoozed"), "DELETE");
    expect(res.status).toBe(422);
    expect(await err(res)).toBe("Built-in views can only be reordered.");
    expect(await viewLogs(b)).toEqual([]);
  });
});

describe("custom views: reorder", () => {
  const reorder = (b: string, ids: string[]) => send(views(b, "/reorder"), "POST", { ids });
  it("interleaves built-ins and customs, and a later GET returns that order", async () => {
    const b = await plan();
    const one = await createView(b, "ZZ one");
    const two = await createView(b, "ZZ two");
    const ids = [two.id, "snoozed", "underfunded", one.id, "money_available", "overfunded"];
    const res = await reorder(b, ids);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.order).toEqual(ids);
    const l = await listViews(b);
    expect(l.order).toEqual(ids);
    expect(l.views.map((v: Json) => v.id)).toEqual([two.id, one.id]);
  });
  it("a view created after a reorder goes last", async () => {
    const b = await plan();
    const one = await createView(b, "ZZ one");
    const ids = [one.id, ...[...BUILTINS].reverse()];
    await reorder(b, ids);
    const two = await createView(b, "ZZ two");
    expect((await listViews(b)).order).toEqual([...ids, two.id]);
  });
  it("missing, extra, duplicate, unknown or deleted ids are 422 and write nothing", async () => {
    const b = await plan();
    const one = await createView(b, "ZZ one");
    const gone = await createView(b, "ZZ gone");
    await send(views(b, `/${gone.id}`), "DELETE");
    const good = [...BUILTINS, one.id];
    const before = await listViews(b);
    const bad = [
      good.slice(1),
      [...good, "extra"],
      [...good, "snoozed"],
      [...good.slice(0, -1), "nope"],
      [...good, gone.id],
      [...good.slice(0, -1), gone.id],
    ];
    for (const ids of bad) {
      const res = await reorder(b, ids);
      expect(res.status).toBe(422);
      expect(await err(res)).toBe("ids must list every view exactly once.");
    }
    expect((await send(views(b, "/reorder"), "POST", { ids: [] })).status).toBe(422);
    expect(await listViews(b)).toEqual(before);
    expect(await viewLogs(b, "plan_view_order")).toEqual([]);
  });
});

describe("custom views: change_log", () => {
  it("create, update and delete write one row each with the REST actor", async () => {
    const b = await plan();
    const [a] = await planCategories(b);
    const v = await createView(b, "ZZ one", [a?.id as string]);
    await send(views(b, `/${v.id}`), "PATCH", { name: "ZZ two" });
    await send(views(b, `/${v.id}`), "DELETE");
    const rows = await viewLogs(b);
    expect(rows.map((r) => r.action)).toEqual(["create", "update", "delete"]);
    for (const r of rows) {
      expect(r.entity_id).toBe(v.id);
      expect(r.actor).toBe("user:tester@localhost");
    }
    expect(rows[0]?.before_json).toBeNull();
    expect(JSON.parse(rows[0]?.after_json)).toMatchObject({
      name: "ZZ one",
      category_ids: [a?.id],
    });
    expect(JSON.parse(rows[0]?.after_json)).toHaveProperty("sort_order");
    expect(JSON.parse(rows[1]?.before_json)).toMatchObject({ name: "ZZ one" });
    expect(JSON.parse(rows[1]?.after_json)).toMatchObject({
      name: "ZZ two",
      category_ids: [a?.id],
    });
    expect(JSON.parse(rows[2]?.before_json)).toMatchObject({ name: "ZZ two" });
    expect(rows[2]?.after_json).toBeNull();
  });
  it("a reorder writes one plan_view_order row with before and after", async () => {
    const b = await plan();
    const one = await createView(b, "ZZ one");
    const ids = [one.id, ...BUILTINS];
    await send(views(b, "/reorder"), "POST", { ids });
    const rows = await viewLogs(b, "plan_view_order");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "update", entity_id: b });
    expect(JSON.parse(rows[0]?.before_json)).toEqual([...BUILTINS, one.id]);
    expect(JSON.parse(rows[0]?.after_json)).toEqual(ids);
  });
});

describe("custom views: deleted and hidden categories", () => {
  it("a deleted category drops out silently; undoing the delete brings it back", async () => {
    const b = await plan();
    const [a, c] = await planCategories(b);
    const v = await createView(b, "ZZ", [a?.id as string, c?.id as string]);
    const del = await send(`/api/v1/budgets/${b}/categories/${c?.id}`, "DELETE");
    expect(del.status).toBe(200);
    expect((await listViews(b)).views[0].category_ids).toEqual([a?.id]);
    expect((await undo(b, setOf(del))).status).toBe(200);
    expect((await listViews(b)).views[0]).toMatchObject({ id: v.id, category_ids: [a?.id, c?.id] });
  });
  it("a deleted group's categories drop out", async () => {
    const b = await plan();
    const cats = await planCategories(b);
    const g = cats[0]?.group_id;
    const inGroup = cats.filter((c) => c.group_id === g).map((c) => c.id);
    const outside = cats.find((c) => c.group_id !== g)?.id as string;
    await createView(b, "ZZ", [...inGroup, outside]);
    const res = await send(`/api/v1/budgets/${b}/category_groups/${g}`, "DELETE");
    expect(res.status).toBe(200);
    expect((await listViews(b)).views[0].category_ids).toEqual([outside]);
  });
  it("a hidden category stays in category_ids", async () => {
    const b = await plan();
    const [a] = await planCategories(b);
    await createView(b, "ZZ", [a?.id as string]);
    await send(`/api/v1/budgets/${b}/categories/${a?.id}`, "PATCH", { hidden: true });
    expect((await listViews(b)).views[0].category_ids).toEqual([a?.id]);
  });
});
