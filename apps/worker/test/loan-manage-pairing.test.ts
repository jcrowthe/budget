import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { makeCategory, rand, send, tool, world } from "./loan-world";
import { listedToolNames } from "./surface";
import { setOf, undo } from "./undo-helpers";

// Loan manage: unpair, and pair with a new category (docs/loan-manage-design.md "Pairing").
const put = (bid: string, loan: string, body: Json) =>
  send(`/api/v1/budgets/${bid}/accounts/${loan}/paired-category`, "PUT", body);
const paired = async (bid: string, id: string) =>
  ((await (await json(`/api/v1/budgets/${bid}/accounts/${id}`)).json()) as Json).data.account
    .paired_category_id;
const accountLogs = (bid: string, id: string) =>
  q(
    "select before_json, after_json from change_log where budget_id = ? and entity_type = 'account' and entity_id = ? and action = 'update'",
    bid,
    id,
  );
const changeCount = async (bid: string) =>
  (await q("select count(*) n from change_log where budget_id = ?", bid))[0]?.n as number;
const name = (p: string) => `ZZ-TEST ${p} ${rand()}`;
const errorOf = async (res: Response): Promise<Json> => ((await res.json()) as Json).error;
const category = (id: string) =>
  q(
    "select id, group_id, name, hidden, kind, deleted_at, sort_order from categories where id = ?",
    id,
  );
const group = (id: string) =>
  q("select id, name, hidden, kind, deleted_at from category_groups where id = ?", id);

describe("unpair", () => {
  it("clears the pairing, logs it and undoes it", async () => {
    const w = await world(true);
    const cat = (await paired(w.bid, w.mortgage.id)) as string;
    expect(cat).toBeTruthy();
    const res = await put(w.bid, w.mortgage.id, { category_id: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.account.paired_category_id).toBeNull();
    expect(await paired(w.bid, w.mortgage.id)).toBeNull();
    expect((await category(cat))[0]?.deleted_at).toBeNull();
    const logs = await accountLogs(w.bid, w.mortgage.id);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]?.before_json).paired_category_id).toBe(cat);
    expect(JSON.parse(logs[0]?.after_json).paired_category_id).toBeNull();
    expect((await undo(w.bid, setOf(res))).status).toBe(200);
    expect(await paired(w.bid, w.mortgage.id)).toBe(cat);
  });
  it("an unpaired loan answers and writes nothing", async () => {
    const w = await world(false);
    const before = await changeCount(w.bid);
    const res = await put(w.bid, w.auto.id, { category_id: null });
    expect(res.status).toBe(200);
    expect(await changeCount(w.bid)).toBe(before);
  });
  it("a closed loan is refused", async () => {
    const w = await world(true);
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(w.mortgage.id).run();
    const res = await put(w.bid, w.mortgage.id, { category_id: null });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).name).toBe("account_closed");
  });
});

describe("pair with a new category", () => {
  it("in a new group: created together, one change set, undone together", async () => {
    const w = await world(false);
    const g = name("Group");
    const c = name("Cat");
    const res = await put(w.bid, w.auto.id, { new_category: { name: c, new_group_name: g } });
    expect(res.status).toBe(200);
    const id = ((await res.json()) as Json).data.account.paired_category_id as string;
    expect(await paired(w.bid, w.auto.id)).toBe(id);
    const cat = (await category(id))[0];
    expect(cat).toMatchObject({ name: c, hidden: 0, kind: null, deleted_at: null });
    const grp = (await group(cat?.group_id))[0];
    expect(grp).toMatchObject({ name: g, hidden: 0, kind: null, deleted_at: null });
    const log = await q(
      "select action, entity_type from change_log where budget_id = ? and change_set_id = ? order by id",
      w.bid,
      setOf(res),
    );
    expect(log.map((l) => `${l.action}:${l.entity_type}`).sort()).toEqual([
      "create:category",
      "create:category_group",
      "update:account",
    ]);
    expect((await undo(w.bid, setOf(res))).status).toBe(200);
    expect(await paired(w.bid, w.auto.id)).toBeNull();
    expect((await category(id))[0]?.deleted_at).not.toBeNull();
    expect((await group(cat?.group_id))[0]?.deleted_at).not.toBeNull();
  });
  it("undo of a re-pair returns to the previous category", async () => {
    const w = await world(true);
    const old = (await paired(w.bid, w.mortgage.id)) as string;
    const res = await put(w.bid, w.mortgage.id, {
      new_category: { name: name("Cat"), new_group_name: name("Group") },
    });
    expect(res.status).toBe(200);
    expect(await paired(w.bid, w.mortgage.id)).not.toBe(old);
    expect((await undo(w.bid, setOf(res))).status).toBe(200);
    expect(await paired(w.bid, w.mortgage.id)).toBe(old);
  });
  it("in an existing group: next sort order", async () => {
    const w = await world(false);
    const existing = await makeCategory(w.bid);
    const res = await put(w.bid, w.auto.id, {
      new_category: { name: name("Cat"), group_id: existing.group_id },
    });
    expect(res.status).toBe(200);
    const id = (await paired(w.bid, w.auto.id)) as string;
    const cat = (await category(id))[0];
    expect(cat?.group_id).toBe(existing.group_id);
    expect(cat?.sort_order).toBe(((await category(existing.id))[0]?.sort_order as number) + 1);
    const log = await q(
      "select entity_type from change_log where budget_id = ? and change_set_id = ?",
      w.bid,
      setOf(res),
    );
    expect(log.map((l) => l.entity_type).sort()).toEqual(["account", "category"]);
  });
  it("refusals write nothing", async () => {
    const w = await world(false);
    const taken = await makeCategory(w.bid);
    const takenGroup = (await q("select name from category_groups where id = ?", taken.group_id))[0]
      ?.name as string;
    const takenCat = (await category(taken.id))[0]?.name as string;
    const hiddenGroup = await makeCategory(w.bid);
    await env.DB.prepare("update category_groups set hidden = 1 where id = ?")
      .bind(hiddenGroup.group_id)
      .run();
    const payGroup = (await env.DB.prepare(
      "select id from category_groups where budget_id = ? and kind is not null",
    )
      .bind(w.bid)
      .first<{ id: string }>()) as { id: string } | null;
    const before = await changeCount(w.bid);
    const bodies: Json[] = [
      { category_id: taken.id, new_category: { name: "x", new_group_name: "y" } },
      {},
      { new_category: { name: "x" } },
      { new_category: { name: "x", group_id: taken.group_id, new_group_name: "y" } },
      { new_category: { name: "x", new_group_name: takenGroup } },
      { new_category: { name: takenCat, group_id: taken.group_id } },
      { new_category: { name: "x", group_id: hiddenGroup.group_id } },
      { new_category: { name: "x", group_id: "nope" } },
      { category_id: taken.id, extra: 1 },
    ];
    if (payGroup) bodies.push({ new_category: { name: "x", group_id: payGroup.id } });
    for (const body of bodies) {
      const res = await put(w.bid, w.auto.id, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    const t = await put(w.bid, w.auto.id, {
      new_category: { name: "x", new_group_name: takenGroup },
    });
    expect((await errorOf(t)).message).toBe("This group name already exists");
    const c = await put(w.bid, w.auto.id, {
      new_category: { name: takenCat, group_id: taken.group_id },
    });
    expect((await errorOf(c)).message).toBe(
      "A category with this name already exists in this group",
    );
    expect(await paired(w.bid, w.auto.id)).toBeNull();
    expect(await changeCount(w.bid)).toBe(before);
  });
});

describe("REST equals MCP", () => {
  it("unpair and new category", async () => {
    const a = await world(true);
    const b = await world(true);
    const args = (w: typeof a) => ({ budget_id: w.bid, loan_account_id: w.mortgage.id });
    const restUn = ((await (await put(a.bid, a.mortgage.id, { category_id: null })).json()) as Json)
      .data.account;
    const mcpUn = await tool("pair_loan_category", { ...args(b), category_id: null });
    expect(mcpUn.isError).not.toBe(true);
    expect(mcpUn.structuredContent.account.paired_category_id).toBeNull();
    expect(Object.keys(mcpUn.structuredContent.account).sort()).toEqual(Object.keys(restUn).sort());
    const nc = { name: name("Cat"), new_group_name: name("Group") };
    const restNew = ((await (await put(a.bid, a.mortgage.id, { new_category: nc })).json()) as Json)
      .data.account;
    const mcpNew = await tool("pair_loan_category", { ...args(b), new_category: nc });
    expect(mcpNew.isError).not.toBe(true);
    expect(mcpNew.structuredContent.account.paired_category_id).toBe(
      await paired(b.bid, b.mortgage.id),
    );
    expect(restNew.paired_category_id).toBe(await paired(a.bid, a.mortgage.id));
    const bad = await tool("pair_loan_category", { ...args(b), new_category: { name: "x" } });
    expect(bad.isError).toBe(true);
    const neither = await tool("pair_loan_category", args(b));
    expect(neither.isError).toBe(true);
    expect(await listedToolNames()).toContain("pair_loan_category");
  });
});
