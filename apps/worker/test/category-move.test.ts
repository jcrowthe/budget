import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { tools as categoryTools } from "../src/mcp/tools/categories";
import { tools as groupTools } from "../src/mcp/tools/category-groups";
import { moveCategory, planMove } from "../src/services/categories";
import { account, send as accountSend } from "./account-helpers";
import {
  actor,
  api,
  cat,
  cell,
  group,
  type Json,
  logs,
  type Month,
  mcp,
  month,
  plan,
  send,
} from "./category-helpers";
import { apiPaths, listedToolNames } from "./surface";
import { setOf, undo } from "./undo-helpers";

const NOV = "2026-11-01";
const DEC = "2026-12-01";

const catIds = (m: Month, groupName: string) => group(m, groupName).categories.map((c) => c.id);
const groupIds = (m: Month) => m.groups.map((g) => g.id);
const moveCat = (bid: string, id: string, body: unknown) =>
  send("POST", api(bid, `/categories/${id}/move`), body);
const moveGroup = (bid: string, id: string, body: unknown) =>
  send("POST", api(bid, `/category_groups/${id}/move`), body);
const body = async (res: Response) => (await res.json()) as Json;

describe("planMove (pure)", () => {
  const row = (id: string, sort: number, kind: string | null = null) => ({ id, sort, kind });

  it("empty scope, first, last, gap, adjacent, tie, anchor kept, noop", () => {
    expect(planMove([], "x", {})).toEqual({ sort: 0, renumber: [] });
    const s = [row("a", 0), row("b", 1), row("c", 2)];
    expect(planMove(s, "x", {})).toEqual({ sort: 1026, renumber: [] });
    expect(planMove(s, "x", { before: "a" })).toEqual({ sort: -1024, renumber: [] });
    expect(planMove(s, "x", { after: "c" })).toEqual({ sort: 1026, renumber: [] });
    const gap = [row("a", 0), row("b", 1000), row("c", 2000)];
    expect(planMove(gap, "x", { after: "a" })).toEqual({ sort: 500, renumber: [] });
    // the moved row itself is excluded first: a goes between b (1000) and c (2000)
    expect(planMove(gap, "a", { after: "b" })).toEqual({ sort: 1500, renumber: [] });
    // adjacent: renormalize around the first row, which keeps its value
    expect(planMove(s, "x", { after: "a" })).toEqual({
      sort: 1024,
      renumber: [
        { id: "b", from: 1, to: 2048 },
        { id: "c", from: 2, to: 3072 },
      ],
    });
    const tie = [row("a", 5), row("b", 5)];
    const tied = planMove(tie, "x", { after: "a" });
    expect(tied).not.toBe("noop");
    if (tied !== "noop") expect(tied.sort).toBe(5 + 1024);
    // the system row keeps its sort and is never renumbered
    const sys = [row("a", 0), row("b", 1), row("P", 5, "credit_card_payments"), row("c", 6)];
    const r = planMove(sys, "x", { before: "b" });
    expect(r).not.toBe("noop");
    if (r !== "noop") {
      expect(r.sort).toBe(5 - 2 * 1024);
      expect(r.renumber.find((n) => n.id === "P")).toBeUndefined();
      expect(r.renumber.map((n) => n.id)).toEqual(["a", "b", "c"]);
    }
    expect(planMove(s, "b", { before: "c" })).toBe("noop");
    expect(planMove(s, "b", { after: "a" })).toBe("noop");
    expect(planMove(s, "c", {})).toBe("noop");
  });
});

describe("move a category within its group (AC1)", () => {
  it("before and after persist, in every month, with neither field = last", async () => {
    const bid = await plan();
    const m0 = await month(bid, NOV);
    const [a1, a2, a3] = catIds(m0, "Needs") as [string, string, string, string];
    const gid = group(m0, "Needs").id;

    const res = await moveCat(bid, a3, { group_id: gid, before_category_id: a1 });
    expect(res.status).toBe(200);
    const moved = (await body(res)).data.category;
    expect(moved).toMatchObject({ id: a3, group_id: gid });
    expect(res.headers.get("Budget-Change-Set")).toBeTruthy();
    expect(catIds(await month(bid, NOV), "Needs").slice(0, 3)).toEqual([a3, a1, a2]);
    expect(catIds(await month(bid, DEC), "Needs").slice(0, 3)).toEqual([a3, a1, a2]);

    const r2 = await moveCat(bid, a1, { group_id: gid, after_category_id: a2 });
    expect(r2.status).toBe(200);
    expect(catIds(await month(bid, NOV), "Needs").slice(0, 3)).toEqual([a3, a2, a1]);

    const r3 = await moveCat(bid, a3, { group_id: gid });
    expect(r3.status).toBe(200);
    const order = catIds(await month(bid, DEC), "Needs");
    expect(order.at(-1)).toBe(a3);
    expect(order).toHaveLength(4);
  });
});

describe("move a category to another group keeps every month's data (AC2)", () => {
  it("only categories.group_id changes: month_categories, RTA and the cells are identical", async () => {
    const bid = await plan();
    const checking = await account(bid, "checking", 900000);
    const m0 = await month(bid, NOV);
    const c = cat(m0, "🛒 Groceries");
    const [b1] = catIds(m0, "Bills") as [string];
    for (const [mo, assigned] of [
      [NOV, 120000],
      [DEC, 45000],
    ] as const) {
      const r = await send("PATCH", api(bid, `/months/${mo}/categories/${c.id}`), { assigned });
      expect(r.status).toBe(200);
    }
    const tx = await accountSend(`/api/v1/budgets/${bid}/transactions`, "POST", {
      account_id: checking.id,
      date: "2026-11-10",
      amount: -30000,
      category_id: c.id,
    });
    expect(tx.status).toBe(201);

    const rows = async () =>
      (
        await env.DB.prepare(
          "select * from month_categories where budget_id = ? and category_id = ? order by month",
        )
          .bind(bid, c.id)
          .all()
      ).results;
    const mcBefore = await rows();
    expect(mcBefore).toHaveLength(2);
    const snap = async () => {
      const [n, d] = [await month(bid, NOV), await month(bid, DEC)];
      return { n, d };
    };
    const before = await snap();

    const res = await moveCat(bid, c.id, {
      group_id: group(before.n, "Bills").id,
      after_category_id: b1,
    });
    expect(res.status).toBe(200);
    expect((await body(res)).data.category.group_id).toBe(group(before.n, "Bills").id);

    expect(await rows()).toEqual(mcBefore);
    const after = await snap();
    for (const k of ["n", "d"] as const) {
      expect(after[k].ready_to_assign).toBe(before[k].ready_to_assign);
      expect(cell(after[k], "🛒 Groceries")).toEqual(cell(before[k], "🛒 Groceries"));
      expect(catIds(after[k], "Bills").slice(0, 2)).toEqual([b1, c.id]);
      expect(catIds(after[k], "Needs")).not.toContain(c.id);
      const [bf, af] = [before[k], after[k]];
      const [cA, cAct, cAv] = cell(bf, "🛒 Groceries") as [number, number, number];
      expect(group(af, "Needs").assigned).toBe(group(bf, "Needs").assigned - cA);
      expect(group(af, "Needs").activity).toBe(group(bf, "Needs").activity - cAct);
      expect(group(af, "Needs").available).toBe(group(bf, "Needs").available - cAv);
      expect(group(af, "Bills").assigned).toBe(group(bf, "Bills").assigned + cA);
      expect(group(af, "Bills").activity).toBe(group(bf, "Bills").activity + cAct);
      expect(group(af, "Bills").available).toBe(group(bf, "Bills").available + cAv);
    }
    expect(cell(after.n, "🛒 Groceries")).toEqual([120000, -30000, 90000]);
  });
});

describe("move a group (AC3)", () => {
  it("before, after and end keep each group's categories", async () => {
    const bid = await plan();
    const m0 = await month(bid, NOV);
    const [g1, g2, g3] = groupIds(m0) as [string, string, string];
    const cats = Object.fromEntries(m0.groups.map((g) => [g.id, g.categories.map((c) => c.id)]));

    const res = await moveGroup(bid, g3, { before_group_id: g1 });
    expect(res.status).toBe(200);
    expect((await body(res)).data.category_group.id).toBe(g3);
    const m1 = await month(bid, NOV);
    expect(groupIds(m1)).toEqual([g3, g1, g2]);
    for (const g of m1.groups) expect(g.categories.map((c) => c.id)).toEqual(cats[g.id]);
    expect(groupIds(await month(bid, DEC))).toEqual([g3, g1, g2]);

    expect((await moveGroup(bid, g3, { after_group_id: g1 })).status).toBe(200);
    expect(groupIds(await month(bid, NOV))).toEqual([g1, g3, g2]);
    expect((await moveGroup(bid, g1, {})).status).toBe(200);
    const m2 = await month(bid, NOV);
    expect(groupIds(m2)).toEqual([g3, g2, g1]);
    for (const g of m2.groups) expect(g.categories.map((c) => c.id)).toEqual(cats[g.id]);
  });
});

describe("group moves follow the displayed order (payment group pinned first)", () => {
  it("after the payment group lands second even when a later group sorts before it in the data", async () => {
    const bid = await plan();
    await account(bid, "creditCard", 0);
    const added = await send("POST", api(bid, "/category_groups"), { name: "ZZ New" });
    expect(added.status).toBe(201);
    const m0 = await month(bid, NOV);
    const names = m0.groups.map((g) => g.name);
    expect(names).toEqual(["Credit Card Payments", "ZZ New", "Bills", "Needs", "Wants"]);
    const ccp = m0.groups[0]?.id as string;
    for (const target of ["Wants", "Needs"]) {
      const res = await moveGroup(bid, group(await month(bid, NOV), target).id, {
        after_group_id: ccp,
      });
      expect(res.status).toBe(200);
      expect((await month(bid, NOV)).groups[1]?.name).toBe(target);
    }
    const refused = await moveGroup(bid, group(m0, "Bills").id, { before_group_id: ccp });
    expect(refused.status).toBe(422);
    expect((await body(refused)).error.name).toBe("invalid_move_target");
  });
});

describe("change_log, one batch, renormalize", () => {
  it("a midpoint move logs the moved row only; a renormalize logs every renumbered row", async () => {
    const bid = await plan();
    const m0 = await month(bid, NOV);
    const gid = group(m0, "Needs").id;
    const [n1, n2, n3, n4] = catIds(m0, "Needs") as [string, string, string, string];
    const before = (await logs(bid, "category")).length;

    // default sorts are consecutive: this renormalizes the group (anchor n1 keeps its sort)
    const r1 = await moveCat(bid, n4, { group_id: gid, after_category_id: n1 });
    expect(r1.status).toBe(200);
    const l1 = (await logs(bid, "category")).slice(before);
    expect(l1.every((l) => l.action === "update" && l.actor === actor)).toBe(true);
    expect(l1.map((l) => l.entity_id).sort()).toEqual([n4, n2, n3].sort());
    const moved = l1.find((l) => l.entity_id === n4) as Json;
    expect(JSON.parse(moved.before_json).sort).toBe(3);
    expect(JSON.parse(moved.after_json).sort).toBe(1024);
    expect(JSON.parse(moved.after_json).group_id).toBe(gid);
    expect(catIds(await month(bid, NOV), "Needs")).toEqual([n1, n4, n2, n3]);

    // now there is a gap between n1 (0) and n4 (1024): exactly one category row and one log row
    const mid = (await logs(bid, "category")).length;
    expect((await moveCat(bid, n3, { group_id: gid, after_category_id: n1 })).status).toBe(200);
    const l2 = (await logs(bid, "category")).slice(mid);
    expect(l2).toHaveLength(1);
    expect(l2[0]?.entity_id).toBe(n3);
    expect(catIds(await month(bid, NOV), "Needs")).toEqual([n1, n3, n4, n2]);
  });

  it("a renormalizing group move never touches the Credit Card Payments group", async () => {
    const bid = await plan();
    await account(bid, "creditCard", 0);
    const m0 = await month(bid, NOV);
    const pay = m0.groups.find((g) => g.kind === "credit_card_payments");
    expect(pay).toBeTruthy();
    const payRow = async () =>
      env.DB.prepare("select sort_order, updated_at from category_groups where id = ?")
        .bind(pay?.id)
        .first();
    const payBefore = await payRow();
    const plain = m0.groups.filter((g) => g.kind === null);
    const [x, y] = [plain.at(-1), plain[0]];
    const before = (await logs(bid, "category_group")).length;
    const res = await moveGroup(bid, (x as { id: string }).id, {
      after_group_id: (y as { id: string }).id,
    });
    expect(res.status).toBe(200);
    const l = (await logs(bid, "category_group")).slice(before);
    expect(l.length).toBeGreaterThan(0);
    expect(l.some((r) => r.entity_id === pay?.id)).toBe(false);
    expect(await payRow()).toEqual(payBefore);
  });

  it("a lost race writes nothing and is retried once", async () => {
    const bid = await plan();
    const m0 = await month(bid, NOV);
    const gid = group(m0, "Needs").id;
    const [n1, , , n4] = catIds(m0, "Needs") as [string, string, string, string];
    let bumped = false;
    const db = new Proxy(env.DB, {
      get(t, k) {
        if (k === "batch") {
          return async (list: D1PreparedStatement[]) => {
            if (!bumped) {
              bumped = true;
              await t
                .prepare("update categories set updated_at = ? where id = ?")
                .bind(new Date(Date.now() + 5000).toISOString(), n4)
                .run();
            }
            return t.batch(list);
          };
        }
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    const before = (await logs(bid, "category")).length;
    const out = await moveCategory({ ...env, DB: db as D1Database }, actor, {
      budget_id: bid,
      category_id: n4,
      group_id: gid,
      before_category_id: n1,
    });
    expect(out.id).toBe(n4);
    expect(bumped).toBe(true);
    // the first attempt (guard mismatch) wrote no log row: exactly one for the moved row
    const mine = (await logs(bid, "category")).slice(before).filter((l) => l.entity_id === n4);
    expect(mine).toHaveLength(1);
    expect(catIds(await month(bid, NOV), "Needs")[0]).toBe(n4);
  });

  it("a move to the current position is a 200 with no write", async () => {
    const bid = await plan();
    const m0 = await month(bid, NOV);
    const gid = group(m0, "Needs").id;
    const [n1, n2] = catIds(m0, "Needs") as [string, string];
    const before = (await logs(bid)).length;
    const res = await moveCat(bid, n1, { group_id: gid, before_category_id: n2 });
    expect(res.status).toBe(200);
    expect((await moveCat(bid, n1, { group_id: gid, before_category_id: n1 })).status).toBe(422);
    expect(
      (await moveGroup(bid, groupIds(m0)[0] as string, { before_group_id: groupIds(m0)[1] }))
        .status,
    ).toBe(200);
    expect((await logs(bid)).length).toBe(before);
  });
});

describe("refusals change nothing", () => {
  async function world() {
    const bid = await plan();
    await account(bid, "creditCard", 0);
    const m = await month(bid, NOV);
    const payGroup = m.groups.find((g) => g.kind === "credit_card_payments") as Month["groups"][0];
    const payCat = payGroup.categories[0] as Month["groups"][0]["categories"][0];
    return { bid, m, payGroup, payCat, needs: group(m, "Needs"), bills: group(m, "Bills") };
  }
  const counts = async (bid: string) => ({
    log: (await logs(bid)).length,
    cats: JSON.stringify(
      (
        await env.DB.prepare(
          "select id, group_id, sort_order, updated_at from categories where budget_id = ? order by id",
        )
          .bind(bid)
          .all()
      ).results,
    ),
    groups: JSON.stringify(
      (
        await env.DB.prepare(
          "select id, sort_order, updated_at from category_groups where budget_id = ? order by id",
        )
          .bind(bid)
          .all()
      ).results,
    ),
  });

  it("422 rules, with the code of each and no change", async () => {
    const w = await world();
    const [n1, n2] = w.needs.categories.map((c) => c.id) as [string, string];
    const [b1] = w.bills.categories.map((c) => c.id) as [string];
    const before = await counts(w.bid);
    const cases: [string, unknown, string][] = [
      [
        n1,
        { group_id: w.needs.id, before_category_id: n2, after_category_id: n2 },
        "unprocessable_entity",
      ],
      [n1, { group_id: w.needs.id, before_category_id: b1 }, "invalid_move_target"],
      [n1, { group_id: w.needs.id, after_category_id: n1 }, "invalid_move_target"],
      [
        n1,
        { group_id: w.needs.id, before_category_id: crypto.randomUUID() },
        "invalid_move_target",
      ],
      [w.payCat.id, { group_id: w.needs.id }, "payment_category_locked"],
      [n1, { group_id: w.payGroup.id }, "payment_group_locked"],
    ];
    for (const [id, b, code] of cases) {
      const res = await moveCat(w.bid, id, b);
      const out = await body(res);
      expect(res.status, JSON.stringify(out)).toBe(422);
      expect(out.error.name).toBe(code);
    }
    const groupBoth = await moveGroup(w.bid, w.needs.id, {
      before_group_id: w.bills.id,
      after_group_id: w.bills.id,
    });
    expect(groupBoth.status).toBe(422);
    for (const b of [{ before_group_id: w.needs.id }, { after_group_id: crypto.randomUUID() }]) {
      const res = await moveGroup(w.bid, w.needs.id, b);
      expect(res.status).toBe(422);
      expect((await body(res)).error.name).toBe("invalid_move_target");
    }
    expect(await counts(w.bid)).toEqual(before);
  });

  it("a name clash in the destination is 422 name_taken", async () => {
    const bid = await plan();
    const m = await month(bid, NOV);
    const bills = group(m, "Bills");
    const needs = group(m, "Needs");
    const dup = await send("POST", api(bid, "/categories"), {
      group_id: bills.id,
      name: " 🛒 groceries ",
    });
    expect(dup.status).toBe(201);
    const before = await counts2(bid);
    const res = await moveCat(bid, cat(m, "🛒 Groceries").id, { group_id: bills.id });
    expect(res.status).toBe(422);
    expect((await body(res)).error.name).toBe("name_taken");
    expect(await counts2(bid)).toEqual(before);
    expect(needs.id).toBeTruthy();
  });

  it("404 for an unknown plan, category, group path and body group", async () => {
    const bid = await plan();
    const m = await month(bid, NOV);
    const c = cat(m, "🛒 Groceries");
    const gid = group(m, "Needs").id;
    const nope = crypto.randomUUID();
    expect((await moveCat(nope, c.id, { group_id: gid })).status).toBe(404);
    expect((await moveCat(bid, nope, { group_id: gid })).status).toBe(404);
    expect((await moveCat(bid, c.id, { group_id: nope })).status).toBe(404);
    expect((await moveCat(bid, c.id, { group_id: "not-a-uuid" })).status).toBe(404);
    expect((await moveGroup(nope, gid, {})).status).toBe(404);
    expect((await moveGroup(bid, nope, {})).status).toBe(404);
  });

  it("payment categories reorder inside their group; the payment group is pinned", async () => {
    const bid = await plan();
    await account(bid, "creditCard", 0, "ZZ Visa");
    await account(bid, "creditCard", 0, "ZZ Amex");
    const m = await month(bid, NOV);
    const pg = m.groups.find((g) => g.kind === "credit_card_payments") as Month["groups"][0];
    const [p1, p2] = pg.categories.map((c) => c.id) as [string, string];
    expect((await moveCat(bid, p2, { group_id: pg.id, before_category_id: p1 })).status).toBe(200);
    const m1 = await month(bid, NOV);
    expect(m1.groups.find((g) => g.id === pg.id)?.categories.map((c) => c.id)).toEqual([p2, p1]);
    // The month engine pins the payment group first, so moving it is refused; others may sit after it.
    const before = await counts2(bid);
    const refused = await moveGroup(bid, pg.id, { after_group_id: groupIds(m1).at(-1) });
    expect(refused.status).toBe(422);
    expect((await body(refused)).error.name).toBe("payment_group_locked");
    expect(await counts2(bid)).toEqual(before);
    const last = m1.groups.at(-1) as { id: string };
    expect((await moveGroup(bid, last.id, { after_group_id: pg.id })).status).toBe(200);
    const m2 = await month(bid, NOV);
    expect(groupIds(m2)[0]).toBe(pg.id);
    expect(groupIds(m2)[1]).toBe(last.id);
  });
});

async function counts2(bid: string) {
  return {
    log: (await logs(bid)).length,
    cats: (
      await env.DB.prepare(
        "select id, group_id, sort_order, updated_at from categories where budget_id = ? order by id",
      )
        .bind(bid)
        .all()
    ).results,
  };
}

describe("REST and MCP agree", () => {
  it("the same moves give the same order, payload shape and actor; refusals carry the same text", async () => {
    const run = async (via: "rest" | "mcp") => {
      const bid = await plan();
      await account(bid, "creditCard", 0, "ZZ Visa");
      const m = await month(bid, NOV);
      const needs = group(m, "Needs");
      const bills = group(m, "Bills");
      const ids = needs.categories.map((c) => c.id) as string[];
      const [, g1, , g3] = groupIds(m) as string[];
      const catArgs = {
        budget_id: bid,
        category_id: ids[3],
        group_id: bills.id,
        before_category_id: bills.categories[0]?.id,
      };
      const grpArgs = { budget_id: bid, group_id: g3, before_group_id: g1 };
      let category: Json;
      let category_group: Json;
      if (via === "rest") {
        const { budget_id, category_id, ...b } = catArgs;
        category = (await body(await moveCat(budget_id, category_id as string, b))).data.category;
        const { group_id, ...gb } = grpArgs;
        category_group = (
          await body(
            await moveGroup(bid, group_id as string, { before_group_id: gb.before_group_id }),
          )
        ).data.category_group;
      } else {
        category = (await mcp("move_category", catArgs)).structuredContent.category;
        category_group = (await mcp("move_category_group", grpArgs)).structuredContent
          .category_group;
      }
      const after = await month(bid, NOV);
      const pay = after.groups.find((g) => g.kind === "credit_card_payments");
      const refusal =
        via === "rest"
          ? (await body(await moveCat(bid, ids[0] as string, { group_id: pay?.id }))).error
          : await mcp("move_category", { budget_id: bid, category_id: ids[0], group_id: pay?.id });
      const log = (await logs(bid, "category")).filter((l) => l.entity_id === ids[3]).at(-1);
      return {
        order: after.groups.map((g) => [g.name, g.categories.map((c) => c.name)]),
        category: Object.keys(category).sort(),
        group: Object.keys(category_group).sort(),
        refused:
          via === "rest"
            ? { detail: refusal.detail, name: refusal.name }
            : { isError: refusal.isError, text: (refusal.content?.[0] as Json)?.text },
        actor: log?.actor,
      };
    };
    const rest = await run("rest");
    const via = await run("mcp");
    expect(via.order).toEqual(rest.order);
    expect(via.category).toEqual(rest.category);
    expect(via.group).toEqual(rest.group);
    expect(rest.actor).toBe(actor);
    expect(via.actor).toMatch(/^mcp:/);
    expect((rest.refused as Json).name).toBe("payment_group_locked");
    expect((via.refused as Json).isError).toBe(true);
    expect((via.refused as Json).text).toContain((rest.refused as Json).detail);
  });

  it("the surface lists both paths and both tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/categories/{category_id}/move",
        "/api/v1/budgets/{budget_id}/category_groups/{group_id}/move",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining(["move_category", "move_category_group"]),
    );
    expect(categoryTools.map((t) => t.name)).toContain("move_category");
    expect(groupTools.map((t) => t.name)).toContain("move_category_group");
    for (const t of [...categoryTools, ...groupTools].filter((t) => t.name.startsWith("move_"))) {
      expect(t.description).toContain("Returns {");
    }
  });
});

describe("undo restores the order", () => {
  // repositories/undo.ts TYPE_MAPS.category already carries group_id and sort, category_group carries sort:
  // no map change is expected; touch undo.ts only if one of these fails for a map reason.
  it("a within-group move, a cross-group renormalizing move and a group move", async () => {
    const bid = await plan();
    const m0 = await month(bid, NOV);
    const needs = group(m0, "Needs");
    const bills = group(m0, "Bills");
    const orderOf = async () => {
      const m = await month(bid, NOV);
      return m.groups.map((g) => [g.id, g.categories.map((c) => c.id)]);
    };
    const start = await orderOf();

    const r1 = await moveCat(bid, needs.categories[3]?.id as string, {
      group_id: needs.id,
      before_category_id: needs.categories[0]?.id,
    });
    expect(r1.status).toBe(200);
    expect((await undo(bid, setOf(r1))).status).toBe(200);
    expect(await orderOf()).toEqual(start);

    const r2 = await moveCat(bid, needs.categories[0]?.id as string, {
      group_id: bills.id,
      after_category_id: bills.categories[0]?.id,
    });
    expect(r2.status).toBe(200);
    expect((await orderOf()).length).toBe(start.length);
    expect((await undo(bid, setOf(r2))).status).toBe(200);
    expect(await orderOf()).toEqual(start);

    const r3 = await moveGroup(bid, groupIds(m0)[2] as string, {
      before_group_id: groupIds(m0)[0],
    });
    expect(r3.status).toBe(200);
    expect((await undo(bid, setOf(r3))).status).toBe(200);
    expect(await orderOf()).toEqual(start);
  });
});
