import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { transactionFacts } from "../src/repositories/accounts";
import { A, account, DAY, data, plan, send, tool, txs } from "./account-helpers";
import { json } from "./helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const T = (bid: string) => `/api/v1/budgets/${bid}/transactions`;
const post = (bid: string, body: unknown) => send(T(bid), "POST", body);
const patch = (bid: string, id: string, body: unknown) => send(`${T(bid)}/${id}`, "PATCH", body);
const read = async (bid: string, aid: string) =>
  (await data(await json(`${A(bid)}/${aid}`))).account as Json;

async function categories(bid: string) {
  const m = await data(await json(`/api/v1/budgets/${bid}/months/2026-11-01`));
  return (m.groups.flatMap((g: Json) => g.categories) as Json[])
    .slice(0, 3)
    .map((c) => c.id as string);
}
async function split(bid: string, aid: string) {
  const [a, b, c] = await categories(bid);
  const res = await post(bid, {
    account_id: aid,
    date: DAY,
    amount: -10000,
    payee_name: "ZZ Parent",
    subtransactions: [
      { amount: -6000, category_id: a },
      { amount: -2500, category_id: b },
      { amount: -1500, category_id: c },
    ],
  });
  expect(res.status).toBe(201);
  return (await data(res)).transaction as Json;
}
const close = (bid: string, aid: string) => send(`${A(bid)}/${aid}/close`, "POST");

describe("balance guards ignore split lines (EXF-593 cases 1-3)", () => {
  it("case 1: adjust-balance and close on an account with a split", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 100000);
    await split(bid, a.id);
    expect((await read(bid, a.id)).balance).toBe(90000);
    const before = (await txs(bid, a.id)).length;
    const adj = await send(`${A(bid)}/${a.id}/adjust-balance`, "POST", { balance: 95000 });
    expect(adj.status).toBe(200);
    expect((await data(adj)).adjustment.amount).toBe(5000);
    expect((await txs(bid, a.id)).length).toBe(before + 1);
    const closed = await close(bid, a.id);
    expect(closed.status).toBe(200);
    expect((await data(closed)).adjustment.amount).toBe(-95000);
    expect((await txs(bid, a.id)).length).toBe(before + 2);
    expect((await read(bid, a.id)).balance).toBe(0);
  });

  it("case 2: the same with a transfer in the account", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 100000);
    const b = await account(bid, "checking", 0);
    const res = await post(bid, {
      account_id: a.id,
      date: DAY,
      amount: -10000,
      transfer_account_id: b.id,
    });
    expect(res.status).toBe(201);
    expect((await read(bid, a.id)).balance).toBe(90000);
    const adj = await send(`${A(bid)}/${a.id}/adjust-balance`, "POST", { balance: 95000 });
    expect(adj.status).toBe(200);
    expect((await data(adj)).adjustment.amount).toBe(5000);
    const closed = await close(bid, a.id);
    expect(closed.status).toBe(200);
    expect((await data(closed)).adjustment.amount).toBe(-95000);
  });

  it("case 3: can_delete counts a split once", async () => {
    const bid = await plan();
    const a = await account(bid, "checking", 100000);
    expect((await read(bid, a.id)).can_delete).toBe(true);
    const s = await split(bid, a.id);
    expect((await read(bid, a.id)).can_delete).toBe(false);
    const facts = await transactionFacts(getDb(env), bid, a.id);
    expect(facts.get(a.id)?.count).toBe(2);
    expect((await send(`${T(bid)}/${s.id}`, "DELETE")).status).toBe(200);
    expect((await read(bid, a.id)).can_delete).toBe(true);
    expect((await send(`${A(bid)}/${a.id}`, "DELETE")).status).toBe(200);
  });
});

describe("a closed account takes no new transactions (EXF-593 cases 4 and 7)", () => {
  async function setup() {
    const bid = await plan();
    const open = await account(bid, "checking", 50000);
    const shut = await account(bid, "checking", 20000);
    const other = await account(bid, "checking", 0);
    const plain = await post(bid, {
      account_id: shut.id,
      date: DAY,
      amount: -100,
      payee_name: "ZZ P",
    });
    const plainRow = (await data(plain)).transaction as Json;
    const tr = await post(bid, {
      account_id: other.id,
      date: DAY,
      amount: -200,
      transfer_account_id: shut.id,
    });
    const trRow = (await data(tr)).transaction as Json;
    expect((await close(bid, shut.id)).status).toBe(200);
    return { bid, open, shut, other, plainRow, trRow };
  }
  const count = async (bid: string) =>
    ((await data(await json(T(bid)))).transactions as Json[]).length;
  const refused = async (res: Response) => {
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("account_closed");
  };

  it("REST refuses new, moved and transferred rows and changes nothing", async () => {
    const s = await setup();
    const n = await count(s.bid);
    const base = { date: DAY, amount: -50, payee_name: "ZZ Q" };
    await refused(await post(s.bid, { ...base, account_id: s.shut.id }));
    await refused(
      await post(s.bid, {
        date: DAY,
        amount: -50,
        account_id: s.shut.id,
        transfer_account_id: s.open.id,
      }),
    );
    await refused(
      await post(s.bid, {
        date: DAY,
        amount: -50,
        account_id: s.open.id,
        transfer_account_id: s.shut.id,
      }),
    );
    const [c1, c2] = await categories(s.bid);
    await refused(
      await post(s.bid, {
        ...base,
        account_id: s.shut.id,
        subtransactions: [
          { amount: -20, category_id: c1 },
          { amount: -30, category_id: c2 },
        ],
      }),
    );
    const mine = (
      await data(
        await post(s.bid, { account_id: s.open.id, date: DAY, amount: -10, payee_name: "ZZ M" }),
      )
    ).transaction as Json;
    await refused(await patch(s.bid, mine.id, { account_id: s.shut.id }));
    await refused(await patch(s.bid, mine.id, { transfer_account_id: s.shut.id }));
    expect(await count(s.bid)).toBe(n + 1);
  });

  it("editing and deleting existing rows of a closed account still work", async () => {
    const s = await setup();
    expect((await patch(s.bid, s.plainRow.id, { memo: "ZZ edited" })).status).toBe(200);
    expect((await patch(s.bid, s.trRow.id, { memo: "ZZ edited" })).status).toBe(200);
    expect((await send(`${T(s.bid)}/${s.plainRow.id}`, "DELETE")).status).toBe(200);
  });

  it("MCP refuses with a readable tool error", async () => {
    const s = await setup();
    const n = await count(s.bid);
    const ct = await tool("create_transaction", {
      budget_id: s.bid,
      account_id: s.shut.id,
      date: DAY,
      amount: -50,
    });
    expect(ct.isError).toBe(true);
    expect(ct.content[0].text).toContain("closed");
    for (const args of [
      { from_account_id: s.open.id, to_account_id: s.shut.id },
      { from_account_id: s.shut.id, to_account_id: s.open.id },
    ]) {
      const r = await tool("create_transfer", { budget_id: s.bid, date: DAY, amount: 50, ...args });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("closed");
    }
    expect(await count(s.bid)).toBe(n);
  });
});
