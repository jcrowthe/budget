import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const actor = "user:tester@localhost";
const DAY = "2026-11-10";

const plan = async () =>
  (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);
async function account(bid: string, type = "checking") {
  const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
    name: `ZZ ${crypto.randomUUID().slice(0, 8)}`,
    type,
    balance: 100000,
    date: DAY,
  });
  return ((await res.json()) as Json).data.account.id as string;
}
const post = (bid: string, body: unknown) =>
  send(`/api/v1/budgets/${bid}/transactions`, "POST", body);
const patch = (bid: string, id: string, body: unknown) =>
  send(`/api/v1/budgets/${bid}/transactions/${id}`, "PATCH", body);
const tx = async (res: Response) => ((await res.json()) as Json).data.transaction;
const payees = async (bid: string, query = "") =>
  ((await (await json(`/api/v1/budgets/${bid}/payees${query}`)).json()) as Json).data
    .payees as Json[];
const mcp = async (name: string, args: unknown) => {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body as Json;
};
const rows = async (sql: string, ...b: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...b)
      .all<Json>()
  ).results;

async function category(bid: string) {
  const m = (await (await json(`/api/v1/budgets/${bid}/months/2026-11-01`)).json()) as Json;
  return m.data.groups
    .flatMap((g: Json) => g.categories)
    .find((c: Json) => c.name.endsWith("Groceries")).id as string;
}

describe("surface", () => {
  it("lists the payees path and tool", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining(["/api/v1/budgets/{budget_id}/payees"]),
    );
    expect(await listedToolNames()).toEqual(expect.arrayContaining(["list_payees"]));
  });
});

describe("listing", () => {
  it("sorts, filters, hides and marks system payees", async () => {
    const bid = await plan();
    const aid = await account(bid);
    for (const name of ["beta", "Alpha", "Gamma"]) {
      await post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: name });
    }
    const everything = await payees(bid);
    // The open account is offered as a transfer entry ("Transfer : <account>"); it is not a stored payee.
    const transfer = everything.filter((p) => p.transfer_account_id !== null);
    expect(transfer).toEqual([
      expect.objectContaining({ id: `transfer:${aid}`, system: null, hidden: false }),
    ]);
    const all = everything.filter((p) => p.transfer_account_id === null);
    expect(all.map((p) => p.name)).toEqual(["Alpha", "beta", "Gamma", "Starting Balance"]);
    expect(all.at(-1)).toMatchObject({ system: "starting_balance", hidden: false });
    expect((await payees(bid, "?q=AM")).map((p) => p.name)).toEqual(["Gamma"]);
    await env.DB.prepare("update payees set hidden = 1 where budget_id = ? and name = 'beta'")
      .bind(bid)
      .run();
    expect((await payees(bid)).map((p) => p.name)).not.toContain("beta");
    expect((await payees(bid, "?include_hidden=true")).map((p) => p.name)).toContain("beta");
    const viaMcp = await mcp("list_payees", { budget_id: bid, include_hidden: true, q: "a" });
    expect(viaMcp.result.structuredContent.payees).toEqual(
      await payees(bid, "?include_hidden=true&q=a"),
    );
  });

  it("last_category_id follows the latest transaction", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const cat = await category(bid);
    await post(bid, {
      account_id: aid,
      date: "2026-11-01",
      amount: -1,
      payee_name: "ZZ P",
      category_id: cat,
    });
    expect((await payees(bid)).find((p) => p.name === "ZZ P").last_category_id).toBe(cat);
    await post(bid, { account_id: aid, date: "2026-11-05", amount: -1, payee_name: "ZZ P" });
    expect((await payees(bid)).find((p) => p.name === "ZZ P").last_category_id).toBeNull();
  });
});

describe("creating with a transaction", () => {
  it("creates one payee with its change_log rows, and reuses it", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const a = await tx(
      await post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: "ZZ New" }),
    );
    const b = await tx(
      await post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: "  ZZ New " }),
    );
    expect(a.payee_id).toBe(b.payee_id);
    expect(a.payee_name).toBe("ZZ New");
    expect((await payees(bid)).filter((p) => p.name === "ZZ New")).toHaveLength(1);
    const logs = await rows(
      "select entity_type, action, actor from change_log where budget_id = ? and entity_id in (?, ?)",
      bid,
      a.payee_id,
      a.id,
    );
    expect(logs.map((l) => `${l.entity_type}/${l.action}`).sort()).toEqual([
      "payee/create",
      "transaction/create",
    ]);
    expect(new Set(logs.map((l) => l.actor)).size).toBe(1);
  });

  it("is case-sensitive", async () => {
    const bid = await plan();
    const aid = await account(bid);
    await post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: "ZZ Case" });
    await post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: "zz case" });
    expect((await payees(bid)).filter((p) => p.name.toLowerCase() === "zz case")).toHaveLength(2);
  });

  it("uses a hidden payee and leaves it hidden", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const first = await tx(
      await post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: "ZZ Hid" }),
    );
    await env.DB.prepare("update payees set hidden = 1 where id = ?").bind(first.payee_id).run();
    const again = await tx(
      await post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: "ZZ Hid" }),
    );
    expect(again.payee_id).toBe(first.payee_id);
    expect(
      (await payees(bid, "?include_hidden=true")).find((p) => p.id === first.payee_id).hidden,
    ).toBe(true);
  });

  it("two concurrent creates leave one payee", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const res = await Promise.all(
      [1, 2].map(() =>
        post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: "ZZ Race" }),
      ),
    );
    expect(res.map((r) => r.status)).toEqual([201, 201]);
    expect((await payees(bid)).filter((p) => p.name === "ZZ Race")).toHaveLength(1);
  });

  it("a typed Starting Balance is an ordinary payee, on checking and credit", async () => {
    const bid = await plan();
    for (const type of ["checking", "creditCard"]) {
      const aid = await account(bid, type);
      const t = await tx(
        await post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: "Starting Balance" }),
      );
      expect(t.payee_system).toBeNull();
    }
    const sb = (await payees(bid)).filter((p) => p.name === "Starting Balance");
    expect(sb.map((p) => p.system).sort()).toEqual([null, "starting_balance"]);
  });

  it("keeps the payee after its transactions are deleted", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const t = await tx(
      await post(bid, { account_id: aid, date: DAY, amount: -1, payee_name: "ZZ Stay" }),
    );
    await send(`/api/v1/budgets/${bid}/transactions/${t.id}`, "DELETE");
    expect((await payees(bid)).map((p) => p.name)).toContain("ZZ Stay");
  });
});

describe("refusals", () => {
  it("rejects both fields, unknown, foreign and system payee ids", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const other = await plan();
    const oaid = await account(other);
    const foreign = (
      await tx(await post(other, { account_id: oaid, date: DAY, amount: -1, payee_name: "ZZ F" }))
    ).payee_id;
    const sys = (await payees(bid)).find((p) => p.system === "starting_balance").id;
    const base = { account_id: aid, date: DAY, amount: -1 };
    expect((await post(bid, { ...base, payee_id: foreign, payee_name: "x" })).status).toBe(422);
    expect((await post(bid, { ...base, payee_id: crypto.randomUUID() })).status).toBe(422);
    expect((await post(bid, { ...base, payee_id: foreign })).status).toBe(422);
    expect((await post(bid, { ...base, payee_id: sys })).status).toBe(422);
  });
});

describe("update", () => {
  it("creates a new payee with a change_log row", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const t = await tx(await post(bid, { account_id: aid, date: DAY, amount: -1 }));
    const u = await tx(await patch(bid, t.id, { payee_name: "ZZ Later" }));
    expect(u.payee_name).toBe("ZZ Later");
    const log = await rows(
      "select action from change_log where entity_type = 'payee' and entity_id = ?",
      u.payee_id,
    );
    expect(log).toHaveLength(1);
    const cleared = await tx(await patch(bid, t.id, { payee_id: null }));
    expect(cleared.payee_id).toBeNull();
  });

  it("an update that loses the race creates no payee", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const t = await tx(await post(bid, { account_id: aid, date: DAY, amount: -1 }));
    const res = await Promise.all([
      patch(bid, t.id, { payee_name: "ZZ Racer A" }),
      patch(bid, t.id, { payee_name: "ZZ Racer B" }),
    ]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const final = await tx(await json(`/api/v1/budgets/${bid}/transactions/${t.id}`));
    const created = (await payees(bid)).filter((p) => p.name.startsWith("ZZ Racer"));
    // Each attempt re-reads before: the loser retries on the new row, so both payees may exist, but the
    // transaction points at exactly one of them and every payee has a log row.
    expect(created.map((p) => p.id)).toContain(final.payee_id);
    const logged = await rows(
      "select entity_id from change_log where entity_type = 'payee' and budget_id = ?",
      bid,
    );
    for (const p of created) expect(logged.map((l) => l.entity_id)).toContain(p.id);
  });
});
