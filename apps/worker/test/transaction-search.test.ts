import { env } from "cloudflare:test";
import { formatToken, parseSearch } from "@budget/schema/transaction-search";
import { beforeAll, describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import {
  type Json,
  account as mkAccount,
  category as mkCategory,
  q as sql,
  tx,
} from "./bulk-helpers";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

const actor = "user:tester@localhost";
const DAY = "2026-11-10";
const call = (path: string, init: RequestInit = {}, body?: unknown) => json(path, init, body);

let bid: string;
let checking: string;
let savings: string;
const names = new Map<string, string>(); // id -> label

async function named(name: string, type = "checking") {
  const res = await call(
    `/api/v1/budgets/${bid}/accounts`,
    { method: "POST" },
    {
      name,
      type,
      balance: 0,
      date: DAY,
    },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.account.id as string;
}
async function add(label: string, body: Json) {
  const t = await tx(bid, { date: DAY, ...body });
  names.set(t.id, label);
  return t.id as string;
}
const listUrl = (query: string, account?: string, extra = "") =>
  `/api/v1/budgets/${bid}${account ? `/accounts/${account}` : ""}/transactions?q=${encodeURIComponent(query)}${extra}`;
async function rest(query: string, account?: string, extra = "") {
  const res = await call(listUrl(query, account, extra));
  expect(res.status, `${query}: ${await res.clone().text()}`).toBe(200);
  return ((await res.json()) as Json).data as Json;
}
/** The labels of the rows `q` returns, sorted. */
async function hits(query: string, account?: string, extra = "") {
  const d = await rest(query, account, extra);
  // Rows this file did not add (an account's Starting Balance) are not part of the cases.
  return d.transactions
    .map((t: Json) => names.get(t.id))
    .filter(Boolean)
    .sort() as string[];
}
async function refused(query: string) {
  const res = await call(listUrl(query));
  expect(res.status).toBe(422);
  const body = (await res.json()) as Json;
  expect(body.error?.name).toBe("unprocessable_entity");
  return JSON.stringify(body);
}

beforeAll(async () => {
  bid = (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
  checking = await named("ZZ-TEST Checking");
  savings = await named("ZZ-TEST Savings");
  const fun = await mkCategory(bid, "Entertainment");
  const groc = await mkCategory(bid, "Groceries");
  await sql("update categories set name = 'ZZ Fun' where id = ?", fun);
  await sql("update categories set name = 'ZZ Groceries' where id = ?", groc);
  const c = checking;
  await add("corner", {
    account_id: c,
    payee_name: "ZZ Corner Store",
    amount: -25000,
    category_id: groc,
    approved: false,
  });
  await add("bakery", {
    account_id: c,
    payee_name: "ZZ Bakery",
    memo: "corner table",
    amount: -15000,
    category_id: groc,
  });
  const market = await add("market", {
    account_id: c,
    payee_name: "ZZ Market",
    amount: -30000,
    category_id: groc,
    cleared: "cleared",
    date: "2026-10-05",
  });
  await call(
    `/api/v1/budgets/${bid}/transactions/bulk`,
    { method: "POST" },
    {
      op: "flag",
      ids: [market],
      value: "red",
    },
  );
  const rta = await add("rta", {
    account_id: c,
    payee_name: "ZZ Employer",
    amount: 30000,
    inflow_to_ready_to_assign: true,
    cleared: "cleared",
  });
  await sql("update transactions set cleared = 'reconciled' where id = ?", rta);
  const matched = await add("matched", {
    account_id: c,
    payee_name: "ZZ Matched",
    amount: -5000,
    category_id: groc,
  });
  await sql("update transactions set import_id = 'ZZ-BANK-1' where id = ?", matched);
  await add("split", {
    account_id: c,
    payee_name: "ZZ Split Payee",
    amount: -30000,
    subtransactions: [
      { amount: -10000, category_id: fun, memo: "gift" },
      { amount: -20000, category_id: groc },
    ],
  });
  await add("transfer", { account_id: c, amount: -7000, transfer_account_id: savings });
  await add("sav", {
    account_id: savings,
    payee_name: "ZZ Savings Payee",
    amount: -2000,
    category_id: groc,
  });
  await add("nocat", { account_id: savings, payee_name: "ZZ Nocat", amount: -1000 });
});

const ALL_C = ["bakery", "corner", "market", "matched", "rta", "split", "transfer"];

describe("register search: matching (EXF-528)", () => {
  it("1 free text is case-insensitive over payee, memo, category and account", async () => {
    expect(await hits("corner", checking)).toEqual(["bakery", "corner"]);
    expect(await hits("CORNER", checking)).toEqual(["bakery", "corner"]);
    expect(await hits("zz fun", checking)).toEqual(["split"]);
    expect(await hits("Savings")).toEqual(["nocat", "sav", "transfer"].sort());
  });

  it("2 Payee matches the payee only, also a transfer's", async () => {
    expect(await hits("Payee: corner", checking)).toEqual(["corner"]);
    expect(await hits("payee: market", checking)).toEqual(["market"]);
    expect(await hits("Payee: Transfer : ZZ-TEST Savings", checking)).toEqual(["transfer"]);
  });

  it("3 Category", async () => {
    expect(await hits("Category: ZZ Fun", checking)).toEqual(["split"]);
    expect(await hits("Category: Ready to Assign", checking)).toEqual(["rta"]);
  });

  it("4 Memo, a split line's included", async () => {
    expect(await hits("Memo: gift", checking)).toEqual(["split"]);
    expect(await hits("memo: corner", checking)).toEqual(["bakery"]);
  });

  it("5 Account", async () => {
    expect(await hits("Account: ZZ-TEST Savings")).toEqual(["nocat", "sav"]);
    expect(await hits("Account: ZZ-TEST Savings", checking)).toEqual([]);
  });

  it("6 Flag", async () => {
    expect(await hits("Flag: Red", checking)).toEqual(["market"]);
    expect(await hits("Flag: None", checking)).toEqual(ALL_C.filter((l) => l !== "market"));
  });

  it("7 the ten Is values", async () => {
    const is = (v: string) => hits(`Is: ${v}`, checking);
    expect(await is("Uncleared")).toEqual(["bakery", "corner", "matched", "split", "transfer"]);
    expect(await is("Cleared")).toEqual(["market"]);
    expect(await is("Reconciled")).toEqual(["rta"]);
    expect(await is("Unreconciled")).toEqual(ALL_C.filter((l) => l !== "rta"));
    expect(await is("Cleared or Reconciled")).toEqual(["market", "rta"]);
    expect(await is("Matched")).toEqual(["matched"]);
    expect(await is("Approved")).toEqual(ALL_C.filter((l) => l !== "corner"));
    expect(await is("Unapproved")).toEqual(["corner"]);
    expect(await is("Needs Category")).toEqual([]);
    expect(await hits("Is: Needs Category")).toEqual(["nocat"]);
    expect(await is("Unapproved or Needs Category")).toEqual(["corner"]);
    expect(await hits("is: unapproved or needs category")).toEqual(["corner", "nocat"]);
  });

  it("8 On, Before and After in the plan's format and ISO", async () => {
    expect(await hits("On: 10/05/2026", checking)).toEqual(["market"]);
    expect(await hits("On: 2026-10-05", checking)).toEqual(["market"]);
    expect(await hits("Before: 10/05/2026", checking)).toEqual(["market"]);
    expect(await hits("After: 11/10/2026", checking)).toEqual(ALL_C.filter((l) => l !== "market"));
    expect(await hits("After: 2026-10-06", checking)).toEqual(ALL_C.filter((l) => l !== "market"));
    const other = (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
    await call(
      `/api/v1/budgets/${other}`,
      { method: "PATCH" },
      { date_format: { format: "DD/MM/YYYY" } },
    );
    const a = await mkAccount(other, "checking", 0);
    const t = await tx(other, { account_id: a, date: "2026-11-05", amount: -1000 });
    const res = await call(
      `/api/v1/budgets/${other}/transactions?q=${encodeURIComponent("On: 05/11/2026")}`,
    );
    expect(((await res.json()) as Json).data.transactions.map((x: Json) => x.id)).toEqual([t.id]);
  });

  it("9 Outflow and Inflow amounts, a split line's included", async () => {
    expect(await hits("Outflow: 25", checking)).toEqual(["corner"]);
    expect(await hits("Outflow: >=25", checking)).toEqual(["corner", "market", "split"]);
    expect(await hits("Outflow: <=7", checking)).toEqual(["matched", "transfer"]);
    expect(await hits("Inflow: 30", checking)).toEqual(["rta"]);
    expect(await hits("Inflow: >=30", checking)).toEqual(["rta"]);
    expect(await hits("Outflow: $25.00", checking)).toEqual(["corner"]);
    expect(await hits("Outflow: 10", checking)).toEqual(["split"]);
    expect(await hits("Outflow: >=20", checking)).toEqual(["corner", "market", "split"]);
  });

  it("10 Income by month", async () => {
    expect(await hits("Income: November 2026", checking)).toEqual(["rta"]);
    expect(await hits("Income: October 2026", checking)).toEqual([]);
  });

  it("11 several tokens are ANDed; empty segments are ignored", async () => {
    expect(await hits("Is: Uncleared, Outflow: >=20", checking)).toEqual(["corner", "split"]);
    expect(await hits("Is: Uncleared, Outflow: >=20,", checking)).toEqual(["corner", "split"]);
    expect(await hits("Is: Uncleared, , Outflow: >=20, ", checking)).toEqual(["corner", "split"]);
  });

  it("12 q combines with needs and since_date", async () => {
    expect(await hits("ZZ", checking, "&needs=approval_or_category")).toEqual(["corner"]);
    expect(await hits("ZZ", checking, "&since_date=2026-11-01")).toEqual(
      ALL_C.filter((l) => l !== "market"),
    );
  });

  it("13 running_balance with q equals the one without", async () => {
    const full = await rest("", checking, "&include=running_balance");
    const some = await rest("Is: Uncleared", checking, "&include=running_balance");
    const byId = new Map(full.transactions.map((t: Json) => [t.id, t.running_balance]));
    expect(some.transactions.length).toBeGreaterThan(0);
    expect(some.transactions.length).toBeLessThan(full.transactions.length);
    for (const t of some.transactions) expect(t.running_balance).toBe(byId.get(t.id));
  });

  it("14 errors, ignored segments, literal wildcards", async () => {
    expect(await refused("Is: banana")).toContain("Is: banana");
    expect(await refused("Outflow: abc")).toContain("Outflow: abc");
    expect(await refused("On: 99/99/2026")).toContain("On: 99/99/2026");
    await refused("a,b,c,d,e,f,g,h,i,j,k");
    await refused("x".repeat(501));
    expect(await hits("Payee:", checking)).toEqual(ALL_C);
    expect(await hits("Transfer : X", checking)).toEqual([]);
    expect(await hits("%", checking)).toEqual([]);
    expect(await hits("_", checking)).toEqual([]);
  });

  it("returns a listed split parent with all its lines", async () => {
    const d = await rest("Category: ZZ Fun", checking);
    expect(d.transactions[0].subtransactions).toHaveLength(2);
  });
});

describe("register search: grammar", () => {
  const ctx = { dateFormat: "MM/DD/YYYY" as const, today: "2026-11-25" };
  it("parses the tokens and reports what it cannot read", () => {
    const r = parseSearch("Payee: big, Is: Uncleared, Outflow: >=20, Before: 11/14, corner", ctx);
    expect(r.invalid).toEqual([]);
    expect(r.tokens).toEqual([
      { type: "text", field: "payee", value: "big" },
      { type: "is", value: "Uncleared" },
      { type: "amount", side: "outflow", op: "gte", milliunits: 20000 },
      { type: "date", op: "before", date: "2026-11-14" },
      { type: "text", field: "any", value: "corner" },
    ]);
    expect(parseSearch("Is: banana, Payee:", ctx).invalid.map((i) => i.segment)).toEqual([
      "Is: banana",
    ]);
  });
  it("writes the token text the UI uses", () => {
    const f = (s: string) => formatToken(parseSearch(s, ctx).tokens[0] as never, ctx.dateFormat);
    expect(f("payee: corner")).toBe("Payee: corner");
    expect(f("is: uncleared")).toBe("Is: Uncleared");
    expect(f("outflow: >=20")).toBe("Outflow: >=20");
    expect(f("Inflow: 30")).toBe("Inflow: 30");
    expect(f("before: 11/14/2026")).toBe("Before: 11/14/2026");
    expect(f("flag: red")).toBe("Flag: Red");
    expect(f("corner")).toBe("corner");
  });
});

describe("register search: REST and MCP agree", () => {
  const queries = [
    "Payee: corner",
    "Category: ZZ Fun",
    "Is: Uncleared",
    "Outflow: >=20",
    "Is: Uncleared, Outflow: >=20",
  ];
  for (const withAccount of [true, false]) {
    it(`search_transactions = the REST list ${withAccount ? "with" : "without"} account_id`, async () => {
      for (const query of queries) {
        const account = withAccount ? checking : undefined;
        const want = (await rest(query, account)).transactions;
        expect(want.length, query).toBeGreaterThan(0);
        const res = await mcpTool("search_transactions", {
          budget_id: bid,
          query,
          ...(account ? { account_id: account } : {}),
        });
        expect(res.isError, JSON.stringify(res)).toBeFalsy();
        expect(JSON.parse(res.content[0].text).transactions).toEqual(want);
      }
    });
  }
  it("a bad query is a tool error", async () => {
    const res = await mcpTool("search_transactions", { budget_id: bid, query: "Is: banana" });
    expect(res.isError).toBe(true);
  });
});

async function mcpTool(name: string, args: unknown): Promise<Json> {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result;
}
