import { env } from "cloudflare:test";
import { ACCOUNT_TYPES, LOAN_ACCOUNT_TYPES } from "@budget/core/account-types";
import { AccountType } from "@budget/schema/accounts";
import { describe, expect, it } from "vitest";
import { type Json, MONTH, plan, q } from "./bulk-helpers";
import { json } from "./helpers";
import { apiDocument, mcpRpc } from "./surface";

// EXF-482: loan accounts in Add Unlinked Account. The server records the values; it does not use them yet.
const DAY = "2026-11-10";
const base = (bid: string) => `/api/v1/budgets/${bid}/accounts`;
const post = (bid: string, body: unknown) => json(base(bid), { method: "POST" }, body);
const rand = () => crypto.randomUUID().slice(0, 8);

const loan = (extra: Json = {}, type = "mortgage"): Json => ({
  name: `ZZ-TEST ${type} ${rand()}`,
  type,
  balance: 180000000,
  interest_rate: "6.5",
  minimum_payment: 1400000,
  date: DAY,
  ...extra,
});

async function initMcp() {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
}
/** The MCP outcome: the tool result, or a protocol error when the input check refuses it. */
async function mcpCreate(bid: string, args: Json) {
  await initMcp();
  const { body } = await mcpRpc(
    "tools/call",
    { name: "create_account", arguments: { budget_id: bid, ...args } },
    2,
  );
  const text = body.result?.content?.[0]?.text ?? JSON.stringify(body.error ?? "");
  return {
    refused: body.result?.isError === true || body.error !== undefined,
    text: String(text),
    sc: body.result?.structuredContent as Json,
  };
}

const rows = async (bid: string) => ({
  accounts: (await q("select count(*) n from accounts where budget_id = ?", bid))[0]?.n as number,
  categories: (
    await q("select count(*) n from categories where budget_id = ? and deleted_at is null", bid)
  )[0]?.n as number,
  groups: (
    await q(
      "select count(*) n from category_groups where budget_id = ? and deleted_at is null",
      bid,
    )
  )[0]?.n as number,
  logs: (await q("select count(*) n from change_log where budget_id = ?", bid))[0]?.n as number,
});

async function monthOf(bid: string) {
  const res = await json(`/api/v1/budgets/${bid}/months/${MONTH}`);
  return ((await res.json()) as Json).data;
}
const anyCategory = async (bid: string) => {
  const m = await monthOf(bid);
  return m.groups[0].categories[0] as Json;
};

describe("loan accounts (AC5-AC8)", () => {
  it("the schema's loan types are core's", () => {
    expect(AccountType.options).toEqual([...ACCOUNT_TYPES]);
    expect(LOAN_ACCOUNT_TYPES).toEqual([
      "mortgage",
      "autoLoan",
      "studentLoan",
      "personalLoan",
      "medicalDebt",
      "otherDebt",
    ]);
  });

  it("AC5: a mortgage is off-plan, last in LOANS, negative, and leaves Ready to Assign alone", async () => {
    const bid = await plan();
    await post(bid, { name: "ZZ-TEST Checking", type: "checking", balance: 500000, date: DAY });
    const before = (await monthOf(bid)).ready_to_assign;
    const res = await post(bid, loan());
    expect(res.status).toBe(201);
    const { account, starting_balance } = ((await res.json()) as Json).data;
    expect(account.balance).toBe(-180000000);
    expect(account.on_budget).toBe(false);
    expect(account.group).toBe("loans");
    const others = (
      await q("select sort_order from accounts where budget_id = ? and id <> ?", bid, account.id)
    ).map((r) => r.sort_order as number);
    for (const s of others) expect(account.sort).toBeGreaterThan(s);
    expect(starting_balance.amount).toBe(-180000000);
    expect(starting_balance.category_id).toBeNull();
    expect(starting_balance.cleared).toBe("cleared");
    expect(starting_balance.payee_name).toBe("Starting Balance");
    expect((await monthOf(bid)).ready_to_assign).toBe(before);
  });

  it("AC6: GET returns the stored fields, escrow 0 when not sent", async () => {
    const bid = await plan();
    const a = ((await (await post(bid, loan({ escrow_amount: 350000 }))).json()) as Json).data
      .account;
    const b = ((await (await post(bid, loan({}, "autoLoan"))).json()) as Json).data.account;
    const get = async (id: string) =>
      ((await (await json(`${base(bid)}/${id}`)).json()) as Json).data.account as Json;
    const ga = await get(a.id);
    expect(ga.interest_rate).toBe("6.5");
    expect(ga.minimum_payment).toBe(1400000);
    expect(ga.escrow_amount).toBe(350000);
    expect(ga.paired_category_id).toBeNull();
    expect((await get(b.id)).escrow_amount).toBe(0);
    const list = ((await (await json(base(bid))).json()) as Json).data.accounts as Json[];
    expect(list.find((x) => x.id === a.id)?.interest_rate).toBe("6.5");
  });

  it("AC7: a new category in a new group is paired; existing group and category too", async () => {
    const bid = await plan();
    const group = `ZZ-TEST Loans ${rand()}`;
    const res = await post(
      bid,
      loan({ new_category: { name: "D3 Car Payment", new_group_name: group } }, "autoLoan"),
    );
    expect(res.status).toBe(201);
    const { account } = ((await res.json()) as Json).data;
    const cats = await q(
      "select id, group_id from categories where budget_id = ? and name = ?",
      bid,
      "D3 Car Payment",
    );
    const groups = await q(
      "select id from category_groups where budget_id = ? and name = ?",
      bid,
      group,
    );
    expect(cats).toHaveLength(1);
    expect(groups).toHaveLength(1);
    expect(account.paired_category_id).toBe(cats[0]?.id);
    expect(cats[0]?.group_id).toBe(groups[0]?.id);

    // existing group
    const gid = groups[0]?.id as string;
    const res2 = await post(
      bid,
      loan({ new_category: { name: "D3 Second", group_id: gid } }, "studentLoan"),
    );
    expect(res2.status).toBe(201);
    const c2 = await q(
      "select id, group_id from categories where budget_id = ? and name = ?",
      bid,
      "D3 Second",
    );
    expect(c2[0]?.group_id).toBe(gid);
    expect(((await res2.json()) as Json).data.account.paired_category_id).toBe(c2[0]?.id);

    // existing category
    const cat = await anyCategory(bid);
    const res3 = await post(bid, loan({ paired_category_id: cat.id }, "personalLoan"));
    expect(res3.status).toBe(201);
    expect(((await res3.json()) as Json).data.account.paired_category_id).toBe(cat.id);
  });

  it("AC8: a 0% rate is accepted and stored as 0; rates are stored canonically", async () => {
    const bid = await plan();
    const res = await post(bid, loan({ interest_rate: "0" }, "medicalDebt"));
    expect(res.status).toBe(201);
    expect(((await res.json()) as Json).data.account.interest_rate).toBe("0");
    const res2 = await post(bid, loan({ interest_rate: "06.50" }, "otherDebt"));
    expect(((await res2.json()) as Json).data.account.interest_rate).toBe("6.5");
    const stored = await q(
      "select interest_rate from accounts where budget_id = ? order by sort_order",
      bid,
    );
    expect(stored.map((r) => r.interest_rate)).toEqual(["0", "6.5"]);
  });

  it("non-loan creation is unchanged: the four fields are null", async () => {
    const bid = await plan();
    const res = await post(bid, { name: "ZZ-TEST C", type: "checking", balance: 1000, date: DAY });
    expect(res.status).toBe(201);
    const { account } = ((await res.json()) as Json).data;
    expect(account.interest_rate).toBeNull();
    expect(account.minimum_payment).toBeNull();
    expect(account.escrow_amount).toBeNull();
    expect(account.paired_category_id).toBeNull();
    expect(account.balance).toBe(1000);
  });
});

describe("loan accounts: refusals (REST and MCP)", () => {
  const nonLoan = ["checking", "creditCard", "otherAsset"];
  const fieldCases: [string, Json][] = [
    ["interest_rate", { interest_rate: "5" }],
    ["minimum_payment", { minimum_payment: 1000 }],
    ["escrow_amount", { escrow_amount: 1000 }],
    ["paired_category_id", { paired_category_id: crypto.randomUUID() }],
    ["new_category", { new_category: { name: "X", new_group_name: "ZZ-TEST G" } }],
  ];
  const bodyCases: [string, Json][] = [
    ["missing rate", { interest_rate: undefined }],
    ["missing payment", { minimum_payment: undefined }],
    ["rate 101", { interest_rate: "101" }],
    ["rate -1", { interest_rate: "-1" }],
    ["rate abc", { interest_rate: "abc" }],
    ["rate 6.5555", { interest_rate: "6.5555" }],
    ["payment -1", { minimum_payment: -1 }],
    [
      "both pairing forms",
      {
        paired_category_id: crypto.randomUUID(),
        new_category: { name: "X", new_group_name: "ZZ-TEST G" },
      },
    ],
    ["new_category with both", { new_category: { name: "X", group_id: "g", new_group_name: "N" } }],
    ["new_category with neither", { new_category: { name: "X" } }],
  ];

  for (const t of nonLoan) {
    for (const [field, extra] of fieldCases) {
      it(`${field} on ${t} is refused`, async () => {
        const bid = await plan();
        const body = { name: `ZZ-TEST ${t}`, type: t, balance: 1000, date: DAY, ...extra };
        const before = await rows(bid);
        const res = await post(bid, body);
        expect(res.status).toBe(422);
        expect(((await res.json()) as Json).error.name).toBe("unprocessable_entity");
        const m = await mcpCreate(bid, body);
        expect(m.refused).toBe(true);
        expect(await rows(bid)).toEqual(before);
      });
    }
  }

  for (const [label, extra] of bodyCases) {
    it(`${label} is refused`, async () => {
      const bid = await plan();
      // Control: without the defect the same request is accepted (so the refusal below is about the defect).
      expect((await post(bid, loan())).status).toBe(201);
      await env.DB.prepare("update accounts set deleted_at = ? where budget_id = ?")
        .bind("2026-11-10T00:00:00.000Z", bid)
        .run();
      const body = loan(extra);
      const before = await rows(bid);
      const res = await post(bid, body);
      expect(res.status).toBe(422);
      expect((await mcpCreate(bid, body)).refused).toBe(true);
      expect(await rows(bid)).toEqual(before);
    });
  }

  it("unusable pairing targets are refused, nothing is written", async () => {
    const bid = await plan();
    // Control: a valid pairing is accepted, so the refusals below are about their target.
    const ok = await post(
      bid,
      loan({ paired_category_id: (await anyCategory(bid)).id }, "autoLoan"),
    );
    expect(ok.status).toBe(201);
    await env.DB.prepare("update accounts set deleted_at = ? where budget_id = ?")
      .bind("2026-11-10T00:00:00.000Z", bid)
      .run();
    const other = await plan();
    const otherCat = await anyCategory(other);
    const hiddenCat = (await monthOf(bid)).groups[0].categories[1] as Json;
    await env.DB.prepare("update categories set hidden = 1 where id = ?").bind(hiddenCat.id).run();
    const deletedCat = (await monthOf(bid)).groups[0].categories[0] as Json;
    await env.DB.prepare("update categories set deleted_at = ? where id = ?")
      .bind("2026-11-01T00:00:00.000Z", deletedCat.id)
      .run();
    await post(bid, { name: "ZZ-TEST Card", type: "creditCard", balance: 1000, date: DAY });
    const payCat = (
      await q("select id, group_id from categories where budget_id = ? and kind is not null", bid)
    )[0] as Json;
    const [normalGroup] = await q(
      "select id from category_groups where budget_id = ? and kind is null limit 1",
      bid,
    );
    const bodies: Json[] = [
      { paired_category_id: otherCat.id },
      { paired_category_id: deletedCat.id },
      { paired_category_id: hiddenCat.id },
      { paired_category_id: payCat.id },
      { paired_category_id: crypto.randomUUID() },
      { new_category: { name: "X", group_id: payCat.group_id } },
      { new_category: { name: "X", group_id: crypto.randomUUID() } },
    ];
    expect(normalGroup).toBeDefined();
    const before = await rows(bid);
    for (const extra of bodies) {
      const res = await post(bid, loan(extra, "autoLoan"));
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect((await mcpCreate(bid, loan(extra, "autoLoan"))).refused).toBe(true);
    }
    expect(await rows(bid)).toEqual(before);
  });

  it("a name taken refuses atomically", async () => {
    const bid = await plan();
    const first = await post(bid, loan({ name: "ZZ-TEST Dup" }));
    expect(first.status).toBe(201);
    // account name taken: 409, no category or group
    let before = await rows(bid);
    const dup = await post(
      bid,
      loan({ name: "zz-test dup", new_category: { name: "A", new_group_name: "ZZ-TEST NG" } }),
    );
    expect(dup.status).toBe(409);
    expect(await rows(bid)).toEqual(before);
    // category name taken in its group: 422, no account, no group
    const m = await monthOf(bid);
    const g = m.groups[0];
    before = await rows(bid);
    const taken = await post(
      bid,
      loan({ new_category: { name: g.categories[0].name, group_id: g.id } }, "autoLoan"),
    );
    expect(taken.status).toBe(422);
    expect(((await taken.json()) as Json).error.detail).toContain("category with this name");
    expect(await rows(bid)).toEqual(before);
    // group name taken: 422, nothing
    const gt = await post(
      bid,
      loan({ new_category: { name: "Z", new_group_name: g.name } }, "autoLoan"),
    );
    expect(gt.status).toBe(422);
    expect(((await gt.json()) as Json).error.detail).toContain("group name");
    expect(await rows(bid)).toEqual(before);
  });
});

describe("loan accounts: one batch, change log, MCP parity", () => {
  it("logs group, category, account and Starting Balance in one change set", async () => {
    const bid = await plan();
    const body = loan(
      { new_category: { name: "D3 Car Payment", new_group_name: "ZZ-TEST LG" } },
      "autoLoan",
    );
    const res = await post(bid, body);
    expect(res.status).toBe(201);
    const { account } = ((await res.json()) as Json).data;
    const log = await q(
      "select entity_type, action, actor, change_set_id, after_json from change_log where budget_id = ? and entity_type in ('category_group','category','account','transaction') and action = 'create' and (entity_type <> 'category_group' or after_json like '%ZZ-TEST LG%') and (entity_type <> 'category' or after_json like '%D3 Car Payment%')",
      bid,
    );
    const kinds = log.map((r) => r.entity_type).sort();
    expect(kinds).toEqual(["account", "category", "category_group", "transaction"]);
    expect(new Set(log.map((r) => r.change_set_id)).size).toBe(1);
    expect(log.every((r) => String(r.actor).startsWith("user:"))).toBe(true);
    const acc = log.find((r) => r.entity_type === "account");
    expect(JSON.parse(acc?.after_json).paired_category_id).toBe(account.paired_category_id);
  });

  it("through MCP the actor is mcp:", async () => {
    const bid = await plan();
    const m = await mcpCreate(
      bid,
      loan({ new_category: { name: "D3 Car Payment", new_group_name: "ZZ-TEST LG" } }, "autoLoan"),
    );
    expect(m.refused).toBe(false);
    const log = await q(
      "select actor from change_log where budget_id = ? and entity_type in ('category_group','category','account') and action = 'create' and (entity_type = 'account' or after_json like '%ZZ-TEST LG%' or after_json like '%D3 Car%')",
      bid,
    );
    expect(log).toHaveLength(3);
    expect(log.every((r) => String(r.actor).startsWith("mcp:"))).toBe(true);
  });

  it("create_account matches REST for a loan", async () => {
    const bid = await plan();
    const args = (n: string) =>
      loan({
        name: n,
        escrow_amount: 350000,
        new_category: { name: `C ${n}`, new_group_name: `G ${n}` },
      });
    const rest = ((await (await post(bid, args("R"))).json()) as Json).data;
    const mcp = await mcpCreate(bid, args("M"));
    const strip = ({
      id,
      budget_id,
      account_id,
      name,
      created_at,
      sort,
      paired_category_id,
      ...r
    }: Json) => r;
    expect(strip(mcp.sc.account)).toEqual(strip(rest.account));
    expect(strip(mcp.sc.starting_balance)).toEqual(strip(rest.starting_balance));
    expect(mcp.sc.account.paired_category_id).toBeTruthy();
    expect(rest.account.interest_rate).toBe("6.5");
  });

  it("create_account takes every REST body property", async () => {
    const doc = (await apiDocument()) as Json;
    let schema =
      doc.paths["/budgets/{budget_id}/accounts"]?.post?.requestBody?.content?.["application/json"]
        ?.schema;
    if (schema?.$ref)
      schema = doc.components.schemas[String(schema.$ref).split("/").pop() as string];
    const props = Object.keys(schema?.properties ?? {});
    expect(props).toEqual(expect.arrayContaining(["interest_rate", "new_category"]));
    await initMcp();
    const list = await mcpRpc("tools/list", {}, 5);
    const t = (list.body.result as Json).tools.find((x: Json) => x.name === "create_account");
    const keys = Object.keys(t.inputSchema.properties);
    for (const p of props) expect(keys, p).toContain(p);
  });
});
