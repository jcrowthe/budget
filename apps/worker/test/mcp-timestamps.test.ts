import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { A, account, DAY, data, send, tool } from "./account-helpers";
import { json } from "./helpers";
import { createPlan, stubPlaid } from "./plaid-stub";
import { listedToolNames, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed tool results
type Json = any;

const MONTH = "2026-11-01";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

type Ctx = {
  bid: string;
  spare: string;
  other: string;
  checking: string;
  tracking: string;
  group: string;
  category: string;
  category2: string;
  tx: string;
  spareTx: string;
  conn: string;
  bankAccount: string;
  bankAccount2: string;
  secondPlan: string;
};
let ctx: Ctx;

async function seed(): Promise<Ctx> {
  const bid = await createPlan("sandbox");
  const opened = await send(`/api/v1/budgets/${bid}`, "PATCH", { opened: true });
  expect(opened.status).toBe(200);
  const checking = (await account(bid, "checking", 100000)).id as string;
  const tracking = (await account(bid, "otherAsset", 50000)).id as string;
  const spare = (await account(bid, "checking", 0)).id as string;
  const other = (await account(bid, "savings", 0)).id as string;
  const m = await data(await json(`/api/v1/budgets/${bid}/months/${MONTH}`));
  const group = m.groups[0].id as string;
  const cats = m.groups.flatMap((g: Json) => g.categories) as Json[];
  const category = cats[0].id as string;
  const category2 = cats[1].id as string;
  const T = `/api/v1/budgets/${bid}/transactions`;
  const mk = async (body: Json) =>
    (await data(await send(T, "POST", body))).transaction.id as string;
  const txId = await mk({
    account_id: checking,
    date: DAY,
    amount: -5000,
    payee_name: "ZZ P",
    category_id: category,
  });
  await mk({
    account_id: checking,
    date: DAY,
    amount: -3000,
    payee_name: "ZZ S",
    subtransactions: [
      { amount: -1000, category_id: category },
      { amount: -1000, category_id: category },
      { amount: -1000, category_id: category2 },
    ],
  });
  await mk({ account_id: checking, date: DAY, amount: -1000, transfer_account_id: other });
  const spareTx = await mk({
    account_id: checking,
    date: DAY,
    amount: -100,
    payee_name: "ZZ T",
    category_id: category,
  });
  expect(
    (await send(`${A(bid)}/${checking}/adjust-balance`, "POST", { balance: 90000 })).status,
  ).toBe(200);

  const now = new Date().toISOString();
  const conn = crypto.randomUUID();
  await env.DB.prepare(
    "insert into bank_connections (id, display_id, environment, plaid_item_id, institution_id, institution_name, nickname, status, provider, last_synced_at, created_at, updated_at) values (?, ?, 'sandbox', ?, 'ins_1', 'ZZ Bank', 'ZZ Bank', 'connected', 'Plaid', ?, ?, ?)",
  )
    .bind(
      conn,
      crypto
        .randomUUID()
        .slice(0, 6)
        .replace(/[^0-9a-f]/g, "a"),
      crypto.randomUUID(),
      now,
      now,
      now,
    )
    .run();
  const bankAccount = crypto.randomUUID();
  const bankAccount2 = crypto.randomUUID();
  for (const [id, name] of [
    [bankAccount, "ZZ Bank One"],
    [bankAccount2, "ZZ Bank Two"],
  ]) {
    await env.DB.prepare(
      "insert into bank_accounts (id, bank_connection_id, plaid_account_id, name, mask, type, subtype, current_balance, available_balance, balance_updated_at, created_at) values (?, ?, ?, ?, '0000', 'depository', 'checking', 1000, 1000, ?, ?)",
    )
      .bind(id, conn, crypto.randomUUID(), name, now, now)
      .run();
  }
  const secondPlan = await createPlan("sandbox");
  return {
    bid,
    spare,
    other,
    checking,
    tracking,
    group,
    category,
    category2,
    tx: txId,
    spareTx,
    conn,
    bankAccount,
    bankAccount2,
    secondPlan,
  };
}

const results = new Map<string, Json>();

/** Tools in call order; the mutating and deleting ones come last, on throwaway rows. */
const CALLS: [string, (c: Ctx) => Json][] = [
  ["list_budgets", () => ({})],
  ["get_budget", (c) => ({ budget_id: c.bid })],
  ["create_budget", () => ({ name: "ZZ-TEST made by tool", bank_environment: "sandbox" })],
  ["update_budget", (c) => ({ budget_id: c.bid, name: "ZZ-TEST renamed" })],
  ["list_accounts", (c) => ({ budget_id: c.bid, include_closed: true })],
  ["get_account", (c) => ({ budget_id: c.bid, account_id: c.checking })],
  ["get_account_summary", (c) => ({ budget_id: c.bid })],
  ["list_transactions", (c) => ({ budget_id: c.bid })],
  ["get_account_balances", (c) => ({ budget_id: c.bid, account_id: c.checking })],
  ["get_transaction", (c) => ({ budget_id: c.bid, transaction_id: c.tx })],
  ["list_payees", (c) => ({ budget_id: c.bid })],
  ["list_bank_connections", (c) => ({ budget_id: c.bid })],
  ["get_bank_connection", (c) => ({ budget_id: c.bid, bank_connection_id: c.conn })],
  ["get_plan_month", (c) => ({ budget_id: c.bid, month: MONTH })],
  ["get_month_summary", (c) => ({ budget_id: c.bid, month: MONTH })],
  ["list_plan_months", (c) => ({ budget_id: c.bid, from: MONTH, to: MONTH })],
  ["get_month_range", (c) => ({ budget_id: c.bid })],
  ["get_month_category", (c) => ({ budget_id: c.bid, month: MONTH, category_id: c.category })],
  ["get_net_worth", (c) => ({ budget_id: c.bid })],
  ["get_category_usage", (c) => ({ budget_id: c.bid, category_id: c.category })],
  ["get_category_group_usage", (c) => ({ budget_id: c.bid, group_id: c.group })],
  ["create_category_group", (c) => ({ budget_id: c.bid, name: "ZZ Group" })],
  ["create_category", (c) => ({ budget_id: c.bid, group_id: c.group, name: "ZZ Cat" })],
  ["rename_category", (c) => ({ budget_id: c.bid, category_id: c.category2, name: "ZZ Renamed" })],
  ["set_category_hidden", (c) => ({ budget_id: c.bid, category_id: c.category2, hidden: true })],
  ["unhide_all_categories", (c) => ({ budget_id: c.bid })],
  ["set_category_note", (c) => ({ budget_id: c.bid, category_id: c.category2, note: "ZZ note" })],
  [
    "rename_category_group",
    (c) => ({ budget_id: c.bid, group_id: c.group, name: "ZZ Group renamed" }),
  ],
  ["set_category_group_hidden", (c) => ({ budget_id: c.bid, group_id: c.group, hidden: false })],
  [
    "set_assigned",
    (c) => ({ budget_id: c.bid, month: MONTH, category_id: c.category, assigned: 1000 }),
  ],
  [
    "move_money",
    (c) => ({
      budget_id: c.bid,
      month: MONTH,
      from: "ready_to_assign",
      to: c.category,
      amount: 100,
    }),
  ],
  [
    "cover_overspending",
    (c) => ({ budget_id: c.bid, month: MONTH, category_id: c.category, from: c.category2 }),
  ],
  ["set_month_note", (c) => ({ budget_id: c.bid, month: MONTH, note: "ZZ month" })],
  [
    "create_transaction",
    (c) => ({
      budget_id: c.bid,
      account_id: c.checking,
      date: DAY,
      amount: -200,
      payee_name: "ZZ N",
      category_id: c.category,
    }),
  ],
  [
    "create_transfer",
    (c) => ({
      budget_id: c.bid,
      from_account_id: c.checking,
      to_account_id: c.other,
      date: DAY,
      amount: 300,
    }),
  ],
  ["update_transaction", (c) => ({ budget_id: c.bid, transaction_id: c.tx, memo: "ZZ memo" })],
  [
    "create_account",
    (c) => ({ budget_id: c.bid, name: "ZZ Made", type: "checking", balance: 1000, date: DAY }),
  ],
  ["update_account", (c) => ({ budget_id: c.bid, account_id: c.tracking, note: "ZZ note" })],
  ["adjust_account_balance", (c) => ({ budget_id: c.bid, account_id: c.tracking, balance: 40000 })],
  ["create_accounts_from_bank", (c) => ({ budget_id: c.bid, bank_account_ids: [c.bankAccount] })],
  [
    "link_account",
    (c) => ({ budget_id: c.bid, account_id: c.spare, bank_account_id: c.bankAccount2 }),
  ],
  ["unlink_account", (c) => ({ budget_id: c.bid, account_id: c.spare })],
  [
    "rename_bank_connection",
    (c) => ({ budget_id: c.bid, bank_connection_id: c.conn, nickname: "ZZ Nick" }),
  ],
  ["close_account", (c) => ({ budget_id: c.bid, account_id: c.spare })],
  ["reopen_account", (c) => ({ budget_id: c.bid, account_id: c.spare })],
  ["delete_transaction", (c) => ({ budget_id: c.bid, transaction_id: c.spareTx })],
  [
    "delete_category",
    (c) => ({ budget_id: c.bid, category_id: c.category2, reassign_to: c.category }),
  ],
  [
    "delete_category_group",
    (c) => ({
      budget_id: c.bid,
      group_id: (Object.values(results.get("create_category_group") ?? {})[0] as Json).id,
    }),
  ],
  ["delete_account", (c) => ({ budget_id: c.bid, account_id: c.spare })],
  ["remove_bank_connection", (c) => ({ budget_id: c.bid, bank_connection_id: c.conn })],
  ["delete_budget", (c) => ({ budget_id: c.secondPlan })],
];

/** A tool this test cannot call, with the reason. */
const NOT_CALLED: Record<string, string> = {};

/** A tool of a file another Build holds, whose result holds a timestamp the description may not name yet. */
const HELD: Record<string, string> = {};

const collect = (v: Json, out: Map<string, string | null>) => {
  if (Array.isArray(v)) for (const x of v) collect(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && ISO.test(x) && !Number.isNaN(Date.parse(x))) out.set(k, x);
      else if (x === null && !out.has(k)) out.set(k, null);
      else collect(x, out);
    }
  }
};

describe("tool descriptions state the timestamp formats (EXF-587)", () => {
  let descriptions: Record<string, string>;
  beforeAll(async () => {
    ctx = await seed();
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const list = await mcpRpc("tools/list", {}, 2);
    descriptions = Object.fromEntries(
      ((list.body.result as Json).tools as Json[]).map((t) => [t.name, t.description as string]),
    );
    stubPlaid({ "/item/remove": () => ({ body: { removed: true } }) });
    for (const [name, args] of CALLS) {
      const res = await tool(name, args(ctx));
      if (res.isError) throw new Error(`${name}: ${res.content?.[0]?.text}`);
      results.set(name, JSON.parse(res.content[0].text));
    }
  });

  it("every listed tool is called or has a reason", async () => {
    const called = new Set(CALLS.map(([n]) => n));
    for (const n of await listedToolNames()) {
      expect(
        called.has(n) !== n in NOT_CALLED,
        `${n}: in exactly one of CALLS and NOT_CALLED`,
      ).toBe(true);
    }
    for (const r of [...Object.values(NOT_CALLED), ...Object.values(HELD)]) expect(r).not.toBe("");
    expect(called.size).toBe(CALLS.length);
  });

  it("finds timestamps in the results and requires each to be named by its tool", () => {
    const all = new Set<string>();
    for (const [name, result] of results) {
      const found = new Map<string, string | null>();
      collect(result, found);
      for (const [k, v] of found) if (v !== null) all.add(k);
      if (name in HELD) continue;
      const desc = descriptions[name] ?? "";
      const named = (/Timestamps \(([^)]*)\) are ISO 8601 date-times in UTC/.exec(desc)?.[1] ?? "")
        .split(", ")
        .filter(Boolean);
      const nullable = (/Timestamps that can be null: ([^.]*)\./.exec(desc)?.[1] ?? "")
        .split(", ")
        .filter(Boolean);
      for (const [k, v] of found) {
        if (v === null && !named.includes(k) && !all.has(k)) continue;
        if (v !== null) expect(named, `${name}: name ${k} among its timestamps`).toContain(k);
      }
      for (const k of nullable) expect(named, `${name}: ${k} is a timestamp`).toContain(k);
    }
    for (const k of ["created_at", "updated_at", "last_modified_on", "last_synced_at"]) {
      expect([...all], `a timestamp key ${k} is found`).toContain(k);
    }
    // a key that is null in a result and a timestamp elsewhere is named, as nullable, where it appears
    for (const [name, result] of results) {
      if (name in HELD) continue;
      const found = new Map<string, string | null>();
      collect(result, found);
      const desc = descriptions[name] ?? "";
      const nullable = (/Timestamps that can be null: ([^.]*)\./.exec(desc)?.[1] ?? "").split(", ");
      for (const [k, v] of found) {
        if (v === null && all.has(k))
          expect(nullable, `${name}: name ${k} as nullable`).toContain(k);
      }
    }
  });

  it("no description still says Dates are YYYY-MM-DD.", () => {
    for (const [name, d] of Object.entries(descriptions)) {
      expect(d, name).not.toContain("Dates are YYYY-MM-DD.");
    }
  });

  it("reports what it called", () => {
    const missing = Object.keys(NOT_CALLED).join(", ") || "none";
    const held = Object.keys(HELD).join(", ") || "none";
    console.info(
      `mcp-timestamps: called ${CALLS.length} of ${CALLS.length + Object.keys(NOT_CALLED).length} tools; not called: ${missing}; held: ${held}`,
    );
  });
});
