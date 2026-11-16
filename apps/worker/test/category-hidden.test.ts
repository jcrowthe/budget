import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/services/accounts";
import { setAssigned } from "../src/services/months";
import { createTransaction } from "../src/services/transactions";
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

const NOV = "2026-11-01";
const PHONE = "📱 Phone & Internet";

async function seeded() {
  const bid = await plan();
  const account = await createAccount(env, actor, {
    budget_id: bid,
    name: "Cash",
    type: "cash",
    on_budget: true,
  });
  await createTransaction(env, actor, {
    budget_id: bid,
    account_id: account.id,
    date: "2026-11-02",
    amount: 100000,
    category_id: null,
    inflow_to_ready_to_assign: true,
  });
  return bid;
}

describe("hide and unhide", () => {
  it("hiding a category leaves the subtotal but not Ready to Assign", async () => {
    const bid = await seeded();
    const m = await month(bid, NOV);
    await setAssigned(env, actor, {
      budget_id: bid,
      month: NOV,
      category_id: cat(m, PHONE).id,
      assigned: 15000,
    });
    const before = await month(bid, NOV);
    const res = await send("PATCH", api(bid, `/categories/${cat(before, PHONE).id}`), {
      hidden: true,
    });
    expect(res.status).toBe(200);
    const after = await month(bid, NOV);
    expect(cat(after, PHONE).hidden).toBe(true);
    expect(group(after, "Bills").assigned).toBe(group(before, "Bills").assigned - 15000);
    expect(after.ready_to_assign).toBe(before.ready_to_assign);
    const log = (await logs(bid, "category")).filter(
      (l) => l.entity_id === cat(before, PHONE).id && l.action === "update",
    );
    expect(log).toMatchObject([{ actor }]);
    expect(JSON.parse(log[0]?.after_json ?? "{}").hidden).toBe(true);
  });

  it("unhiding one category of a hidden group brings the group back with only that category", async () => {
    const bid = await plan();
    const m = await month(bid, NOV);
    const wants = group(m, "Wants");
    expect(
      (await send("PATCH", api(bid, `/category_groups/${wants.id}`), { hidden: true })).status,
    ).toBe(200);
    const target = wants.categories[1];
    const res = await send("PATCH", api(bid, `/categories/${target?.id}`), { hidden: false });
    expect(res.status).toBe(200);
    const after = group(await month(bid, NOV), "Wants");
    expect(after.hidden).toBe(false);
    expect(after.categories.map((c) => [c.name, c.hidden])).toEqual(
      wants.categories.map((c) => [c.name, c.id !== target?.id]),
    );
    expect(after.categories.map((c) => c.sort)).toEqual(wants.categories.map((c) => c.sort));
    // The group row and each sibling that was hidden by this change are logged.
    const cats = (await logs(bid, "category")).filter((l) => l.action === "update");
    expect(cats).toHaveLength(wants.categories.length - 1);
    expect(cats.every((l) => l.actor === actor)).toBe(true);
    const groupLogs = (await logs(bid, "category_group")).filter(
      (l) => l.entity_id === wants.id && l.action === "update",
    );
    expect(groupLogs).toHaveLength(2);
  });

  it("unhiding a group unhides all its categories; unhide_all clears the plan", async () => {
    const bid = await plan();
    const m = await month(bid, NOV);
    const wants = group(m, "Wants");
    const bills = group(m, "Bills");
    await send("PATCH", api(bid, `/categories/${bills.categories[0]?.id}`), { hidden: true });
    await send("PATCH", api(bid, `/category_groups/${wants.id}`), { hidden: true });
    await send("PATCH", api(bid, `/categories/${wants.categories[0]?.id}`), { hidden: true });
    const r = await send("PATCH", api(bid, `/category_groups/${wants.id}`), { hidden: false });
    expect(r.status).toBe(200);
    expect(group(await month(bid, NOV), "Wants").categories.every((c) => !c.hidden)).toBe(true);

    await send("PATCH", api(bid, `/category_groups/${wants.id}`), { hidden: true });
    const all = await send("POST", api(bid, "/categories/unhide_all"));
    expect(all.status).toBe(200);
    const body = ((await all.json()) as Json).data.unhidden;
    expect(body.group_ids).toEqual([wants.id]);
    expect(body.category_ids).toEqual([bills.categories[0]?.id]);
    const after = await month(bid, NOV);
    expect(after.groups.every((g) => !g.hidden && g.categories.every((c) => !c.hidden))).toBe(true);
    const again = ((await (await send("POST", api(bid, "/categories/unhide_all"))).json()) as Json)
      .data.unhidden;
    expect(again).toEqual({ group_ids: [], category_ids: [] });
    expect((await send("POST", api(crypto.randomUUID(), "/categories/unhide_all"))).status).toBe(
      404,
    );
  });

  it("MCP unhide_all_categories equals the REST unhide_all and logs an mcp actor", async () => {
    const hideSome = async () => {
      const bid = await plan();
      const m = await month(bid, NOV);
      const wants = group(m, "Wants");
      const bills = group(m, "Bills");
      await send("PATCH", api(bid, `/categories/${bills.categories[0]?.id}`), { hidden: true });
      await send("PATCH", api(bid, `/category_groups/${wants.id}`), { hidden: true });
      return { bid, wantsId: wants.id, catId: bills.categories[0]?.id };
    };
    const a = await hideSome();
    const b = await hideSome();
    const rest = ((await (await send("POST", api(a.bid, "/categories/unhide_all"))).json()) as Json)
      .data;
    const viaMcp = await mcp("unhide_all_categories", { budget_id: b.bid });
    expect(viaMcp.isError).toBeFalsy();
    expect(rest.unhidden).toEqual({ group_ids: [a.wantsId], category_ids: [a.catId] });
    expect(viaMcp.structuredContent).toEqual({
      unhidden: { group_ids: [b.wantsId], category_ids: [b.catId] },
    });
    const after = await month(b.bid, NOV);
    expect(after.groups.every((g) => !g.hidden && g.categories.every((c) => !c.hidden))).toBe(true);
    const updates = (await logs(b.bid)).filter(
      (l) =>
        l.action === "update" &&
        (l.entity_type === "category" || l.entity_type === "category_group"),
    );
    const mine = updates.filter((l) => l.after_json?.includes('"hidden":false'));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((l) => l.actor.startsWith("mcp:") || l.actor === actor)).toBe(true);
    expect(mine.some((l) => l.actor.startsWith("mcp:"))).toBe(true);
    expect((await mcp("unhide_all_categories", { budget_id: crypto.randomUUID() })).isError).toBe(
      true,
    );
  });

  it("set_category_hidden over MCP equals the PATCH", async () => {
    const bid = await plan();
    const m = await month(bid, NOV);
    const [a, b] = [cat(m, PHONE), cat(m, "⚡️ Utilities")];
    const rest = (
      (await (
        await send("PATCH", api(bid, `/categories/${a.id}`), { hidden: true })
      ).json()) as Json
    ).data.category;
    const viaMcp = (
      await mcp("set_category_hidden", { budget_id: bid, category_id: b.id, hidden: true })
    ).structuredContent.category;
    expect(viaMcp).toMatchObject({ ...rest, id: b.id, name: b.name, sort: b.sort });
    const log = (await logs(bid, "category")).filter(
      (l) => l.entity_id === b.id && l.action === "update",
    );
    expect(log[0]?.actor.startsWith("mcp:")).toBe(true);
  });
});
