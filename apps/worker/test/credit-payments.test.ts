import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "../src/services/accounts";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { setAssigned } from "../src/services/months";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

// EXF-532: the payment category of a credit account, its history rows and the locks around it.
// biome-ignore lint/suspicious/noExplicitAny: parsed bodies in tests
type Json = any;
const actor = "user:tester@localhost";
const NOV = "2026-11-01";

const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);
const newPlan = async () =>
  (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
const api = (bid: string, p: string) => `/api/v1/budgets/${bid}${p}`;
const body = async (res: Response) => (await res.json()) as Json;
async function account(bid: string, name: string, type: string, balance = 0) {
  const res = await send(api(bid, "/accounts"), "POST", {
    name,
    type,
    balance,
    date: "2026-11-02",
  });
  expect(res.status).toBe(201);
  return (await body(res)).data.account.id as string;
}
const month = async (bid: string) => (await body(await json(api(bid, `/months/${NOV}`)))).data;
const logs = async (bid: string) =>
  (
    await env.DB.prepare(
      "select actor, entity_type, action, entity_id, after_json from change_log where budget_id = ? order by rowid",
    )
      .bind(bid)
      .all<Json>()
  ).results;
const mcp = async (name: string, args: unknown) => {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
};
const text = (r: Json) => r.content[0].text as string;

describe("the payment category lifecycle", () => {
  it("creating a card makes the group and the category, with history rows and the actor", async () => {
    const bid = await newPlan();
    const before = await logs(bid);
    await account(bid, "ZZ Checking", "checking");
    expect((await month(bid)).groups.some((g: Json) => g.kind !== null)).toBe(false);
    const visa = await account(bid, "ZZ Visa", "creditCard", 120000);
    const m = await month(bid);
    expect(m.groups[0]).toMatchObject({
      name: "Credit Card Payments",
      kind: "credit_card_payments",
    });
    expect(m.groups[0].categories).toHaveLength(1);
    expect(m.groups[0].categories[0]).toMatchObject({
      name: "ZZ Visa",
      kind: "credit_card_payment",
      account_id: visa,
      available: 0,
      activity: 0,
    });
    const created = (await logs(bid)).slice(before.length);
    const kinds = created.map((l) => `${l.action} ${l.entity_type}`);
    expect(kinds).toContain("create category_group");
    expect(kinds).toContain("create category");
    expect(created.every((l) => l.actor.length > 0)).toBe(true);
    const cat = created.find((l) => l.entity_type === "category");
    expect(JSON.parse(cat.after_json)).toMatchObject({
      name: "ZZ Visa",
      kind: "credit_card_payment",
      account_id: visa,
      group_id: m.groups[0].id,
    });
    // A card's Starting Balance changes neither Ready to Assign nor the payment category.
    expect(m.groups[0].categories[0].activity).toBe(0);
    // A second card and a Line of Credit made through MCP join the same group.
    const r = await mcp("create_account", {
      budget_id: bid,
      name: "ZZ LOC",
      type: "lineOfCredit",
      balance: 0,
      date: "2026-11-03",
    });
    expect(r.isError).toBeFalsy();
    const m2 = await month(bid);
    expect(m2.groups.filter((g: Json) => g.kind !== null)).toHaveLength(1);
    expect(m2.groups[0].categories.map((c: Json) => c.name)).toEqual(["ZZ Visa", "ZZ LOC"]);
    const mcpLog = (await logs(bid)).filter((l) => l.entity_type === "category").at(-1);
    expect(mcpLog.actor.startsWith("mcp:")).toBe(true);
  });

  it("two cards created one after the other leave one group, one group log row and one category per card", async () => {
    const bid = await newPlan();
    const visa = await account(bid, "ZZ Visa", "creditCard");
    const amex = await account(bid, "ZZ Amex", "lineOfCredit");
    const groups = (
      await env.DB.prepare(
        "select id from category_groups where budget_id = ? and kind is not null and deleted_at is null",
      )
        .bind(bid)
        .all<Json>()
    ).results;
    expect(groups).toHaveLength(1);
    const cats = (
      await env.DB.prepare(
        "select account_id, group_id from categories where budget_id = ? and kind is not null and deleted_at is null",
      )
        .bind(bid)
        .all<Json>()
    ).results;
    expect(cats.map((c) => c.account_id).sort()).toEqual([visa, amex].sort());
    expect(cats.every((c) => c.group_id === groups[0].id)).toBe(true);
    const groupLogs = (await logs(bid)).filter(
      (l) =>
        l.entity_type === "category_group" &&
        l.action === "create" &&
        l.after_json.includes('"kind"'),
    );
    expect(groupLogs.map((l) => l.entity_id)).toEqual([groups[0].id]);
  });

  it("renaming the card renames the category (with a log row); closing keeps it; deleting removes it", async () => {
    const bid = await newPlan();
    const visa = await account(bid, "ZZ Visa", "creditCard");
    const rename = await send(api(bid, `/accounts/${visa}`), "PATCH", { name: "ZZ Visa Gold" });
    expect(rename.status).toBe(200);
    let m = await month(bid);
    expect(m.groups[0].categories[0].name).toBe("ZZ Visa Gold");
    const upd = (await logs(bid)).filter(
      (l) => l.entity_type === "category" && l.action === "update",
    );
    expect(upd).toHaveLength(1);
    const close = await send(api(bid, `/accounts/${visa}/close`), "POST", {});
    expect(close.status).toBe(200);
    expect((await month(bid)).groups[0].categories.map((c: Json) => c.name)).toEqual([
      "ZZ Visa Gold",
    ]);
    const reopen = await send(api(bid, `/accounts/${visa}/reopen`), "POST", {});
    expect(reopen.status).toBe(200);
    const del = await send(api(bid, `/accounts/${visa}`), "DELETE");
    expect(del.status).toBe(200);
    m = await month(bid);
    expect(m.groups[0]).toMatchObject({ kind: "credit_card_payments" });
    expect(m.groups[0].categories).toEqual([]);
    const gone = (await logs(bid)).filter(
      (l) => l.entity_type === "category" && l.action === "delete",
    );
    expect(gone).toHaveLength(1);
  });

  it("deleting a card whose payment category has assigned money is refused (409) and writes nothing", async () => {
    const bid = await newPlan();
    const visa = await account(bid, "ZZ Visa", "creditCard");
    const payId = (await month(bid)).groups[0].categories[0].id;
    await setAssigned(env, actor, {
      budget_id: bid,
      month: NOV,
      category_id: payId,
      assigned: 1000,
    });
    const before = await logs(bid);
    const res = await send(api(bid, `/accounts/${visa}`), "DELETE");
    expect(res.status).toBe(409);
    expect((await body(res)).error.name).toBe("payment_category_has_history");
    expect(await logs(bid)).toHaveLength(before.length);
    expect((await month(bid)).groups[0].categories).toHaveLength(1);
    const t = await mcp("delete_account", { budget_id: bid, account_id: visa });
    expect(t.isError).toBe(true);
  });

  it("money landing on the payment category between the read and the batch leaves the account alive (409, nothing written)", async () => {
    const bid = await newPlan();
    const visa = await account(bid, "ZZ Visa", "creditCard");
    const payId = (await month(bid)).groups[0].categories[0].id;
    const before = await logs(bid);
    let raced = false;
    const db = new Proxy(env.DB, {
      get(t, k) {
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k === "batch") {
          return async (list: D1PreparedStatement[]) => {
            if (!raced) {
              raced = true;
              await setAssigned(env, actor, {
                budget_id: bid,
                month: NOV,
                category_id: payId,
                assigned: 1000,
              });
            }
            return t.batch(list);
          };
        }
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    await expect(
      deleteAccount({ ...env, DB: db } as typeof env, actor, bid, visa),
    ).rejects.toMatchObject({ status: 409, code: "payment_category_has_history" });
    expect(raced).toBe(true);
    const acc = await env.DB.prepare("select deleted_at from accounts where id = ?")
      .bind(visa)
      .first<Json>();
    expect(acc.deleted_at).toBeNull();
    const cat = await env.DB.prepare("select deleted_at from categories where id = ?")
      .bind(payId)
      .first<Json>();
    expect(cat.deleted_at).toBeNull();
    const tx = await env.DB.prepare(
      "select count(*) n from transactions where account_id = ? and deleted_at is null",
    )
      .bind(visa)
      .first<Json>();
    expect(tx.n).toBe(1);
    expect((await logs(bid)).filter((l) => l.action === "delete")).toHaveLength(
      before.filter((l) => l.action === "delete").length,
    );
  });
});

describe("the locks answer 422 with a named error and write nothing", () => {
  async function setup() {
    const bid = await newPlan();
    await account(bid, "ZZ Visa", "creditCard");
    const m = await month(bid);
    const g = m.groups[0];
    const own = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ Own" });
    const ordinary = await createCategory(env, actor, {
      budget_id: bid,
      group_id: own.id,
      name: "ZZ Ordinary",
    });
    return { bid, group: g.id as string, pay: g.categories[0].id as string, ordinary: ordinary.id };
  }
  const refused = async (res: Response, name: string) => {
    expect(res.status).toBe(422);
    expect((await body(res)).error.name).toBe(name);
  };

  it("the group: rename, hide, delete, and a category added to it", async () => {
    const s = await setup();
    const before = await logs(s.bid);
    await refused(
      await send(api(s.bid, `/category_groups/${s.group}`), "PATCH", { name: "X" }),
      "payment_group_locked",
    );
    await refused(
      await send(api(s.bid, `/category_groups/${s.group}`), "PATCH", { hidden: true }),
      "payment_group_locked",
    );
    await refused(
      await send(api(s.bid, `/category_groups/${s.group}`), "DELETE"),
      "payment_group_locked",
    );
    await refused(
      await send(api(s.bid, "/categories"), "POST", { group_id: s.group, name: "ZZ Sneaky" }),
      "payment_group_locked",
    );
    expect(await logs(s.bid)).toHaveLength(before.length);
    // collapsing is interface state and still works
    expect(
      (await send(api(s.bid, `/category_groups/${s.group}`), "PATCH", { collapsed: true })).status,
    ).toBe(200);
  });

  it("the payment category: rename, hide, delete, a target, reassign_to", async () => {
    const s = await setup();
    const before = await logs(s.bid);
    await refused(
      await send(api(s.bid, `/categories/${s.pay}`), "PATCH", { name: "X" }),
      "payment_category_locked",
    );
    await refused(
      await send(api(s.bid, `/categories/${s.pay}`), "PATCH", { hidden: true }),
      "payment_category_locked",
    );
    await refused(
      await send(api(s.bid, `/categories/${s.pay}`), "DELETE"),
      "payment_category_locked",
    );
    await refused(
      await send(api(s.bid, `/categories/${s.pay}/target`), "PUT", {
        cadence: "monthly",
        behavior: "set_aside",
        amount: 1000,
      }),
      "payment_category_target",
    );
    const del = await send(api(s.bid, `/categories/${s.ordinary}?reassign_to=${s.pay}`), "DELETE");
    await refused(del, "invalid_reassign_target");
    expect(await logs(s.bid)).toHaveLength(before.length);
    // a note is fine
    expect(
      (await send(api(s.bid, `/categories/${s.pay}`), "PATCH", { note: "pay in full" })).status,
    ).toBe(200);
  });

  it("the tools refuse the same calls", async () => {
    const s = await setup();
    for (const [tool, args, message] of [
      [
        "rename_category_group",
        { group_id: s.group, name: "X" },
        "belongs to your credit accounts",
      ],
      [
        "set_category_group_hidden",
        { group_id: s.group, hidden: true },
        "belongs to your credit accounts",
      ],
      ["delete_category_group", { group_id: s.group }, "belongs to your credit accounts"],
      [
        "create_category",
        { group_id: s.group, name: "ZZ Sneaky" },
        "belongs to your credit accounts",
      ],
      ["rename_category", { category_id: s.pay, name: "X" }, "belongs to its account"],
      ["set_category_hidden", { category_id: s.pay, hidden: true }, "belongs to its account"],
      ["delete_category", { category_id: s.pay }, "belongs to its account"],
      [
        "set_category_target",
        { category_id: s.pay, cadence: "monthly", behavior: "set_aside", amount: 1000 },
        "can't have a target yet",
      ],
    ] as const) {
      const r = await mcp(tool, { budget_id: s.bid, ...args });
      expect(r.isError, tool).toBe(true);
      expect(text(r), tool).toContain(message);
    }
  });
});

describe("surface", () => {
  it("still lists the account, category and target paths and tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/accounts",
        "/api/v1/budgets/{budget_id}/accounts/{account_id}",
        "/api/v1/budgets/{budget_id}/categories/{category_id}/target",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "create_account",
        "update_account",
        "delete_account",
        "set_category_target",
      ]),
    );
  });
});
