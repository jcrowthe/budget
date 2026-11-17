import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const actor = "user:tester@localhost";
const DAY = "2026-11-10";
const MONTH = "2026-11-01";

const plan = async () =>
  (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);
const data = async (res: Response) => ((await res.json()) as Json).data;

async function account(bid: string, type = "checking", balance = 500000) {
  const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
    name: `ZZ ${crypto.randomUUID().slice(0, 8)}`,
    type,
    balance,
    date: DAY,
  });
  expect(res.status).toBe(201);
  return (await data(res)).account.id as string;
}
const post = (bid: string, body: unknown) =>
  send(`/api/v1/budgets/${bid}/transactions`, "POST", body);
const patch = (bid: string, id: string, body: unknown) =>
  send(`/api/v1/budgets/${bid}/transactions/${id}`, "PATCH", body);
const del = (bid: string, id: string) =>
  send(`/api/v1/budgets/${bid}/transactions/${id}`, "DELETE");
const read = async (bid: string, id: string) =>
  (await data(await json(`/api/v1/budgets/${bid}/transactions/${id}`))).transaction as Json;
const created = async (res: Response) => {
  expect(res.status).toBe(201);
  return (await data(res)).transaction as Json;
};
const rows = async (bid: string, aid: string) =>
  (await data(await json(`/api/v1/budgets/${bid}/accounts/${aid}/transactions`)))
    .transactions as Json[];
const balances = async (bid: string, aid: string) =>
  (await data(await json(`/api/v1/budgets/${bid}/accounts/${aid}/transactions`))).balances as Json;
const logs = async (bid: string, entityId?: string) =>
  (
    await env.DB.prepare(
      `select action, actor, entity_id from change_log where budget_id = ? and entity_type = 'transaction' ${entityId ? "and entity_id = ?" : ""} order by rowid`,
    )
      .bind(...(entityId ? [bid, entityId] : [bid]))
      .all<{ action: string; actor: string; entity_id: string }>()
  ).results;

/** Every category's activity, `uncategorized` and Ready to Assign of the month. */
async function figures(bid: string) {
  const m = await data(await json(`/api/v1/budgets/${bid}/months/${MONTH}`));
  return {
    rta: m.ready_to_assign as number,
    uncategorized: m.uncategorized?.activity ?? 0,
    activity: Object.fromEntries(
      m.groups.flatMap((g: Json) => g.categories).map((c: Json) => [c.name, c.activity]),
    ) as Record<string, number>,
    groceriesName: m.groups
      .flatMap((g: Json) => g.categories)
      .find((c: Json) => c.name.endsWith("Groceries")).name as string,
    groceries: m.groups
      .flatMap((g: Json) => g.categories)
      .find((c: Json) => c.name.endsWith("Groceries")).id as string,
  };
}
const mcp = async (name: string, args: unknown) => {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body as Json;
};

async function pair(bid: string, from: string, to: string, amount = -50000, extra = {}) {
  const tx = await created(
    await post(bid, { account_id: from, date: DAY, amount, transfer_account_id: to, ...extra }),
  );
  return { tx, other: await read(bid, tx.transfer_transaction_id) };
}

describe("surface", () => {
  it("lists create_transfer", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining(["/api/v1/budgets/{budget_id}/transactions"]),
    );
    expect(await listedToolNames()).toEqual(expect.arrayContaining(["create_transfer"]));
  });
});

describe("creating a pair", () => {
  it("writes both rows linked, opposite, uncleared on the other side, one log row each", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid, "savings", 200000);
    const { tx, other } = await pair(bid, a, b, -50000, { memo: "move", cleared: "cleared" });
    expect(tx).toMatchObject({
      account_id: a,
      amount: -50000,
      transfer_account_id: b,
      payee_id: null,
      category_id: null,
      cleared: "cleared",
    });
    expect(tx.payee_name).toMatch(/^Transfer : ZZ /);
    expect(other).toMatchObject({
      account_id: b,
      amount: 50000,
      date: DAY,
      memo: "move",
      cleared: "uncleared",
      transfer_account_id: a,
      transfer_transaction_id: tx.id,
    });
    expect(tx.transfer_transaction_id).toBe(other.id);
    const l = await logs(bid);
    expect(
      l.filter((x) => x.action === "create" && [tx.id, other.id].includes(x.entity_id)),
    ).toEqual([
      expect.objectContaining({ actor, entity_id: tx.id }),
      expect.objectContaining({ actor, entity_id: other.id }),
    ]);
    expect(await balances(bid, a)).toMatchObject({ cleared: 450000 });
    expect(await balances(bid, b)).toMatchObject({
      cleared: 200000,
      uncleared: 50000,
      working: 250000,
    });
  });

  it("is atomic: a colliding second id leaves neither row nor log row", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const existing = (await rows(bid, a))[0].id as string;
    const real = crypto.randomUUID.bind(crypto);
    let n = 0;
    crypto.randomUUID = (() => (n++ === 0 ? real() : existing)) as typeof crypto.randomUUID;
    try {
      const before = await logs(bid);
      const res = await post(bid, {
        account_id: a,
        date: DAY,
        amount: -1000,
        transfer_account_id: b,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await logs(bid)).toHaveLength(before.length);
      expect(await rows(bid, a)).toHaveLength(1);
      expect(await rows(bid, b)).toHaveLength(1);
    } finally {
      crypto.randomUUID = real;
    }
  });

  it("refuses bad requests with 422", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const closed = await account(bid);
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(closed).run();
    const base = { account_id: a, date: DAY, amount: -1000 };
    const cat = (await figures(bid)).groceries;
    for (const body of [
      { ...base, transfer_account_id: a },
      { ...base, transfer_account_id: closed },
      { ...base, transfer_account_id: crypto.randomUUID() },
      { ...base, transfer_account_id: b, payee_name: "Shop" },
      { ...base, transfer_account_id: b, category_id: cat },
      { ...base, transfer_account_id: b, inflow_to_ready_to_assign: true },
      { ...base, payee_id: `transfer:${b}` },
    ]) {
      expect((await post(bid, body)).status).toBe(422);
    }
    expect(await rows(bid, a)).toHaveLength(1);
  });

  it("MCP create_transfer makes the same pair with the mcp actor", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const r = await mcp("create_transfer", {
      budget_id: bid,
      from_account_id: a,
      to_account_id: b,
      amount: 25000,
      date: DAY,
    });
    const out = r.result.structuredContent;
    expect(out.from_transaction).toMatchObject({
      account_id: a,
      amount: -25000,
      transfer_account_id: b,
    });
    expect(out.to_transaction).toMatchObject({ account_id: b, amount: 25000 });
    const l = (await logs(bid)).filter((x) => x.entity_id === out.from_transaction.id);
    expect(l[0]?.actor.startsWith("mcp:")).toBe(true);
    const bad = await mcp("create_transfer", {
      budget_id: bid,
      from_account_id: a,
      to_account_id: b,
      amount: -1,
      date: DAY,
    });
    expect(bad.result.isError).toBe(true);
  });
});

describe("re-link and closed accounts", () => {
  it("a re-link logs one update, one delete and one create, and every created id exists", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const c = await account(bid);
    const { tx, other } = await pair(bid, a, b);
    const before = (await logs(bid)).length;
    const res = await patch(bid, tx.id, { transfer_account_id: c });
    expect(res.status).toBe(200);
    const fresh = (await logs(bid)).slice(before);
    const newId = (await data(res)).transaction.transfer_transaction_id as string;
    expect(fresh.map((l) => [l.action, l.entity_id]).sort()).toEqual(
      [
        ["update", tx.id],
        ["delete", other.id],
        ["create", newId],
      ].sort(),
    );
    for (const l of fresh.filter((x) => x.action === "create")) {
      expect((await json(`/api/v1/budgets/${bid}/transactions/${l.entity_id}`)).status).toBe(200);
    }
    expect((await json(`/api/v1/budgets/${bid}/transactions/${other.id}`)).status).toBe(404);
  });

  it("an existing transfer stays editable after the other account closes", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const { tx } = await pair(bid, a, b);
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(b).run();
    expect((await patch(bid, tx.id, { cleared: "cleared", memo: "still" })).status).toBe(200);
    expect((await read(bid, tx.transfer_transaction_id)).memo).toBe("still");
    // a new link to a closed account is still refused
    const c = await account(bid);
    expect((await patch(bid, tx.id, { transfer_account_id: b })).status).toBe(200);
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(c).run();
    expect((await patch(bid, tx.id, { transfer_account_id: c })).status).toBe(422);
  });
});

describe("editing a pair", () => {
  it("mirrors amount, date and memo from either side, never cleared or approved", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const { tx, other } = await pair(bid, a, b);
    const res = await patch(bid, other.id, {
      amount: 60000,
      date: "2026-11-09",
      memo: "x",
      cleared: "cleared",
    });
    expect(res.status).toBe(200);
    expect(await read(bid, tx.id)).toMatchObject({
      amount: -60000,
      date: "2026-11-09",
      memo: "x",
      cleared: "uncleared",
    });
    expect(await read(bid, other.id)).toMatchObject({ amount: 60000, cleared: "cleared" });
    await patch(bid, tx.id, { approved: false });
    expect((await read(bid, other.id)).approved).toBe(true);
    const updates = (await logs(bid)).filter((x) => x.action === "update").map((x) => x.entity_id);
    expect(updates).toEqual(expect.arrayContaining([tx.id, other.id]));
  });

  it("follows an account move, re-links, un-transfers and turns a plain row into a transfer", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const c = await account(bid);
    const { tx, other } = await pair(bid, a, b);
    // move this side to c
    expect((await patch(bid, tx.id, { account_id: c })).status).toBe(200);
    expect(await read(bid, other.id)).toMatchObject({ transfer_account_id: c });
    expect((await patch(bid, tx.id, { account_id: b })).status).toBe(422);
    // re-link to a
    const re = await data(await patch(bid, tx.id, { transfer_account_id: a }));
    expect(re.transaction.transfer_account_id).toBe(a);
    const gone = await json(`/api/v1/budgets/${bid}/transactions/${other.id}`);
    expect(gone.status).toBe(404);
    const newOther = await read(bid, re.transaction.transfer_transaction_id);
    expect(newOther).toMatchObject({ account_id: a, amount: 50000, cleared: "uncleared" });
    // un-transfer
    const plain = await data(
      await patch(bid, tx.id, { transfer_account_id: null, payee_name: "Shop" }),
    );
    expect(plain.transaction).toMatchObject({ transfer_account_id: null, payee_name: "Shop" });
    expect((await json(`/api/v1/budgets/${bid}/transactions/${newOther.id}`)).status).toBe(404);
    // plain -> transfer
    const again = await data(await patch(bid, tx.id, { transfer_account_id: b }));
    expect(again.transaction).toMatchObject({ transfer_account_id: b, payee_id: null });
    expect(await read(bid, again.transaction.transfer_transaction_id)).toMatchObject({
      amount: 50000,
      account_id: b,
    });
    // payee fields on a transfer
    expect((await patch(bid, tx.id, { payee_name: "x" })).status).toBe(422);
  });

  it("deleting either side deletes both", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const { tx, other } = await pair(bid, a, b);
    expect((await del(bid, other.id)).status).toBe(200);
    expect((await json(`/api/v1/budgets/${bid}/transactions/${tx.id}`)).status).toBe(404);
    expect(await rows(bid, a)).toHaveLength(1);
    expect(await rows(bid, b)).toHaveLength(1);
    const deletes = (await logs(bid)).filter((x) => x.action === "delete").map((x) => x.entity_id);
    expect(deletes).toEqual(expect.arrayContaining([tx.id, other.id]));
  });

  it("a reconciled other side refuses the pair's mirror and delete, and writes nothing", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const { tx, other } = await pair(bid, a, b);
    await env.DB.prepare("update transactions set cleared = 'reconciled' where id = ?")
      .bind(other.id)
      .run();
    const before = await logs(bid);
    for (const res of [await patch(bid, tx.id, { amount: -1000 }), await del(bid, tx.id)]) {
      expect(res.status).toBe(409);
      expect(((await res.json()) as Json).error.name).toBe("transaction_reconciled");
    }
    expect(await logs(bid)).toHaveLength(before.length);
    expect((await patch(bid, tx.id, { cleared: "cleared" })).status).toBe(200);
    // The confirmation lets the mirrored amount through (D4).
    expect((await patch(bid, tx.id, { amount: -1000, confirm_reconciled: true })).status).toBe(200);
  });
});

describe("month figures per category rule", () => {
  const same = (x: Awaited<ReturnType<typeof figures>>, y: Awaited<ReturnType<typeof figures>>) => {
    expect(y.rta).toBe(x.rta);
    expect(y.uncategorized).toBe(x.uncategorized);
    expect(y.activity).toEqual(x.activity);
  };

  it("on-plan to on-plan (cash and cash) changes nothing", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid, "savings", 200000);
    const before = await figures(bid);
    await pair(bid, a, b, -50000);
    same(before, await figures(bid));
  });

  it("EXF-532: cash to a card is a payment: only that card's payment category moves", async () => {
    const bid = await plan();
    const a = await account(bid);
    const card = await account(bid, "creditCard", 0);
    const cardName = (await data(await json(`/api/v1/budgets/${bid}/accounts/${card}`))).account
      .name as string;
    const before = await figures(bid);
    expect(before.activity[cardName]).toBe(0);
    await pair(bid, a, card, -20000);
    const after = await figures(bid);
    expect(after.rta).toBe(before.rta);
    expect(after.uncategorized).toBe(before.uncategorized);
    expect(after.activity).toEqual({ ...before.activity, [cardName]: -20000 });
  });

  it("on-plan to tracking: category, Ready to Assign, or uncategorized", async () => {
    const bid = await plan();
    const a = await account(bid);
    const t = await account(bid, "otherAsset", 100000);
    const before = await figures(bid);
    const { tx } = await pair(bid, a, t, -10000);
    const open = await figures(bid);
    expect(open.uncategorized).toBe(before.uncategorized - 10000);
    expect((await read(bid, tx.id)).category_id).toBeNull();
    await patch(bid, tx.id, { category_id: before.groceries });
    const cat = await figures(bid);
    expect(cat.uncategorized).toBe(before.uncategorized);
    expect(cat.activity[before.groceriesName]).toBe(
      (before.activity[before.groceriesName] ?? 0) - 10000,
    );
    // the tracking side never takes a category
    const trackingSide = await read(bid, tx.transfer_transaction_id);
    expect((await patch(bid, trackingSide.id, { category_id: before.groceries })).status).toBe(422);
  });

  it("tracking to on-plan takes Ready to Assign on the on-plan side; tracking to tracking changes nothing", async () => {
    const bid = await plan();
    const a = await account(bid);
    const t = await account(bid, "otherAsset", 100000);
    const t2 = await account(bid, "otherAsset", 100000);
    const before = await figures(bid);
    const { other } = await pair(bid, t, a, -10000);
    expect((await figures(bid)).uncategorized).toBe(before.uncategorized + 10000);
    await patch(bid, other.id, { inflow_to_ready_to_assign: true });
    const rta = await figures(bid);
    expect(rta.uncategorized).toBe(before.uncategorized);
    expect(rta.rta).toBe(before.rta + 10000);
    const mid = await figures(bid);
    await pair(bid, t, t2, -5000);
    same(mid, await figures(bid));
  });
});

describe("payees", () => {
  it("offers a transfer entry per open account, none for a closed one, found by q=transfer", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const closed = await account(bid);
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(closed).run();
    const all = (await data(await json(`/api/v1/budgets/${bid}/payees?q=transfer`)))
      .payees as Json[];
    expect(all.map((p) => p.transfer_account_id).sort()).toEqual([a, b].sort());
    expect(all.every((p) => p.name.startsWith("Transfer : ") && p.id.startsWith("transfer:"))).toBe(
      true,
    );
  });
});
