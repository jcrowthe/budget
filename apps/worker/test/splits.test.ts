import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

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
  return (await data(res)).account.id as string;
}
const post = (bid: string, body: unknown) =>
  send(`/api/v1/budgets/${bid}/transactions`, "POST", body);
const patch = (bid: string, id: string, body: unknown) =>
  send(`/api/v1/budgets/${bid}/transactions/${id}`, "PATCH", body);
const read = async (bid: string, id: string) =>
  (await data(await json(`/api/v1/budgets/${bid}/transactions/${id}`))).transaction as Json;
const accountData = async (bid: string, aid: string) =>
  data(await json(`/api/v1/budgets/${bid}/accounts/${aid}/transactions`));
async function month(bid: string) {
  const m = await data(await json(`/api/v1/budgets/${bid}/months/${MONTH}`));
  const cats = m.groups.flatMap((g: Json) => g.categories) as Json[];
  const find = (suffix: string) => cats.find((c) => c.name.endsWith(suffix)) as Json;
  return {
    rta: m.ready_to_assign as number,
    uncategorized: (m.uncategorized?.activity ?? 0) as number,
    cats,
    id: (suffix: string) => find(suffix).id as string,
    activity: (suffix: string) => find(suffix).activity as number,
  };
}
const logsOf = async (id: string) =>
  (
    await env.DB.prepare(
      "select action, actor, after_json from change_log where entity_id = ? order by rowid",
    )
      .bind(id)
      .all<{ action: string; actor: string; after_json: string | null }>()
  ).results;
const mcp = async (name: string, args: unknown) => {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body as Json;
};

async function seed() {
  const bid = await plan();
  const aid = await account(bid);
  const m = await month(bid);
  const g = m.id("Groceries");
  const d = m.id("Dining out");
  const f = m.id("Entertainment");
  return { bid, aid, g, d, f, m };
}
const lines3 = (s: { g: string; d: string; f: string }) => [
  { amount: -60000, category_id: s.g },
  { amount: -25000, category_id: s.d },
  { amount: -15000, category_id: s.f, payee_name: "ZZ Toy Shop", memo: "gift" },
];
async function createSplit(s: Awaited<ReturnType<typeof seed>>, extra = {}) {
  const res = await post(s.bid, {
    account_id: s.aid,
    date: DAY,
    amount: -100000,
    payee_name: "ZZ Parent",
    subtransactions: lines3(s),
    ...extra,
  });
  expect(res.status).toBe(201);
  return (await data(res)).transaction as Json;
}

describe("creating a split", () => {
  it("stores the parent with its lines, one log row, a new line payee once", async () => {
    const s = await seed();
    const before = await month(s.bid);
    const tx = await createSplit(s, {
      subtransactions: [
        { amount: -60000, category_id: s.g, payee_name: "ZZ New Shop" },
        { amount: -40000, category_id: s.d, payee_name: "ZZ New Shop" },
      ],
    });
    expect(tx.category_id).toBeNull();
    expect(tx.subtransactions.map((l: Json) => l.amount)).toEqual([-60000, -40000]);
    expect(tx.subtransactions[0].payee_name).toBe("ZZ New Shop");
    const payees = (await data(await json(`/api/v1/budgets/${s.bid}/payees?q=ZZ New Shop`))).payees;
    expect(payees).toHaveLength(1);
    const l = await logsOf(tx.id);
    expect(l).toHaveLength(1);
    expect(l[0]?.actor).toBe(actor);
    expect(JSON.parse(l[0]?.after_json as string).subtransactions).toHaveLength(2);
    const after = await month(s.bid);
    expect(after.activity("Groceries") - before.activity("Groceries")).toBe(-60000);
    expect(after.activity("Dining out") - before.activity("Dining out")).toBe(-40000);
  });

  it("counts lines in their categories, the parent in nothing, the balance once", async () => {
    const s = await seed();
    const before = await month(s.bid);
    const bal0 = (await accountData(s.bid, s.aid)).balances;
    const tx = await createSplit(s);
    const after = await month(s.bid);
    expect(after.activity("Groceries") - before.activity("Groceries")).toBe(-60000);
    expect(after.activity("Dining out") - before.activity("Dining out")).toBe(-25000);
    expect(after.activity("Entertainment") - before.activity("Entertainment")).toBe(-15000);
    expect(after.uncategorized).toBe(before.uncategorized);
    const d = await accountData(s.bid, s.aid);
    expect(d.balances.uncleared).toBe(bal0.uncleared - 100000);
    // lines are never list rows; the parent carries them in order
    expect(d.transactions.filter((t: Json) => t.id === tx.id)).toHaveLength(1);
    expect(d.transactions).toHaveLength(2);
    const parent = d.transactions.find((t: Json) => t.id === tx.id);
    expect(parent.subtransactions.map((l: Json) => l.memo)).toEqual([null, null, "gift"]);
    const plan = (await data(await json(`/api/v1/budgets/${s.bid}/transactions`))).transactions;
    expect(plan.find((t: Json) => t.id === tx.id).subtransactions).toHaveLength(3);
    expect(await read(s.bid, tx.id)).toMatchObject({ category_id: null });
    // a line id is not a transaction
    expect(
      (await json(`/api/v1/budgets/${s.bid}/transactions/${tx.subtransactions[0].id}`)).status,
    ).toBe(404);
    expect((await patch(s.bid, tx.subtransactions[0].id, { memo: "x" })).status).toBe(404);
  });

  it("an uncategorized line counts as uncategorized", async () => {
    const s = await seed();
    const before = await month(s.bid);
    await createSplit(s, {
      subtransactions: [{ amount: -60000, category_id: s.g }, { amount: -40000 }],
    });
    const after = await month(s.bid);
    expect(after.uncategorized - before.uncategorized).toBe(-40000);
  });

  it("refuses with 422", async () => {
    const s = await seed();
    const t = await account(s.bid, "otherAsset", 1000);
    const [l1, l2] = lines3(s) as [Json, Json, Json];
    const base = { account_id: s.aid, date: DAY, amount: -100000 };
    for (const body of [
      { ...base, subtransactions: [{ amount: -100000, category_id: s.g }] },
      { ...base, subtransactions: [l1, l2] },
      { ...base, category_id: s.g, subtransactions: lines3(s) },
      { ...base, account_id: t, subtransactions: lines3(s) },
      { ...base, transfer_account_id: t, subtransactions: lines3(s) },
      {
        ...base,
        subtransactions: [{ ...l1, inflow_to_ready_to_assign: true }, ...lines3(s).slice(1)],
      },
    ]) {
      expect((await post(s.bid, body)).status).toBe(422);
    }
    const unbalanced = await post(s.bid, { ...base, subtransactions: [l1, l2] });
    expect(((await unbalanced.json()) as Json).error.detail).toContain("add up to");
  });

  it("MCP create_transaction with lines equals REST; get_transaction returns the lines", async () => {
    const s = await seed();
    const r = await mcp("create_transaction", {
      budget_id: s.bid,
      account_id: s.aid,
      date: DAY,
      amount: -100000,
      subtransactions: lines3(s),
    });
    const tx = r.result.structuredContent.transaction;
    expect(tx.subtransactions).toHaveLength(3);
    const got = await mcp("get_transaction", { budget_id: s.bid, transaction_id: tx.id });
    expect(got.result.structuredContent.transaction.subtransactions).toEqual(tx.subtransactions);
    const rest = await createSplit(s);
    expect(rest.subtransactions.map((l: Json) => l.amount)).toEqual(
      tx.subtransactions.map((l: Json) => l.amount),
    );
  });
});

describe("changing a split", () => {
  it("replaces the lines, carries date and cleared, and goes back to plain with []", async () => {
    const s = await seed();
    const tx = await createSplit(s);
    expect((await patch(s.bid, tx.id, { amount: -80000 })).status).toBe(422);
    expect((await patch(s.bid, tx.id, { category_id: s.g })).status).toBe(422);
    const upd = await data(
      await patch(s.bid, tx.id, {
        amount: -80000,
        subtransactions: [
          { amount: -50000, category_id: s.g },
          { amount: -30000, category_id: s.d },
        ],
      }),
    );
    expect(upd.transaction.subtransactions).toHaveLength(2);
    const live = await env.DB.prepare(
      "select count(*) n from transactions where parent_transaction_id = ? and deleted_at is null",
    )
      .bind(tx.id)
      .first<{ n: number }>();
    expect(live?.n).toBe(2);
    await patch(s.bid, tx.id, { date: "2026-11-09", cleared: "cleared" });
    const rows = (
      await env.DB.prepare(
        "select date, cleared from transactions where parent_transaction_id = ? and deleted_at is null",
      )
        .bind(tx.id)
        .all<{ date: string; cleared: string }>()
    ).results;
    expect(rows).toEqual([
      { date: "2026-11-09", cleared: "cleared" },
      { date: "2026-11-09", cleared: "cleared" },
    ]);
    const plain = await data(await patch(s.bid, tx.id, { subtransactions: [], category_id: s.g }));
    expect(plain.transaction).toMatchObject({ subtransactions: [], category_id: s.g });
    expect(await logsOf(tx.id)).toHaveLength(4);
  });

  it("deleting the parent takes the lines; a plain row becomes a split", async () => {
    const s = await seed();
    const plain = (
      await data(
        await post(s.bid, { account_id: s.aid, date: DAY, amount: -100000, category_id: s.g }),
      )
    ).transaction;
    const before = await month(s.bid);
    const done = await data(await patch(s.bid, plain.id, { subtransactions: lines3(s) }));
    expect(done.transaction.category_id).toBeNull();
    expect((await month(s.bid)).activity("Dining out")).toBe(before.activity("Dining out") - 25000);
    expect((await send(`/api/v1/budgets/${s.bid}/transactions/${plain.id}`, "DELETE")).status).toBe(
      200,
    );
    const left = await env.DB.prepare(
      "select count(*) n from transactions where parent_transaction_id = ? and deleted_at is null",
    )
      .bind(plain.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect((await month(s.bid)).activity("Dining out")).toBe(before.activity("Dining out"));
  });

  it("a deleted category's lines move with the category", async () => {
    const s = await seed();
    const tx = await createSplit(s);
    const del = await send(
      `/api/v1/budgets/${s.bid}/categories/${s.f}?reassign_to=${s.g}`,
      "DELETE",
    );
    expect(del.status).toBe(200);
    const after = await read(s.bid, tx.id);
    expect(after.subtransactions[2].category_id).toBe(s.g);
  });

  it("the payee's last category ignores split parents and lines", async () => {
    const s = await seed();
    await post(s.bid, {
      account_id: s.aid,
      date: "2026-11-01",
      amount: -1000,
      payee_name: "ZZ Last",
      category_id: s.d,
    });
    await createSplit(s, { payee_name: "ZZ Last" });
    const p = (await data(await json(`/api/v1/budgets/${s.bid}/payees?q=ZZ Last`))).payees[0];
    expect(p.last_category_id).toBe(s.d);
  });
});
