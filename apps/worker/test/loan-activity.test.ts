import { env } from "cloudflare:test";
import { interestNote, LoanActivityResponse } from "@budget/schema/loan-activity";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { setAssigned } from "../src/services/months";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";
import { setOf, undo } from "./undo-helpers";

// EXF-540 AC1-5: the loan engine, Account Activity and Record Payment through REST and MCP. Milliunits.
const actor = "user:tester@localhost";
const NOV = "2026-11-01";
const DEC = "2026-12-01";
const D15 = "2026-11-15";
const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);
const rand = () => crypto.randomUUID().slice(0, 8);

async function world() {
  const bid = (await createBudget(env, actor, { name: `ZZ-TEST ${rand()}` })).id;
  const open = async (body: Json) => {
    const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
      date: D15,
      ...body,
      name: `ZZ ${body.name} ${rand()}`,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Json).data.account as Json;
  };
  const checking = await open({ name: "Checking", type: "checking", balance: 10000000 });
  const rtaBefore = await rta(bid);
  const mortgage = await open({
    name: "Mortgage",
    type: "mortgage",
    balance: 200000000,
    interest_rate: "6",
    minimum_payment: 1500000,
    escrow_amount: 300000,
    new_category: { name: "Mortgage Pay", new_group_name: "ZZ Loans" },
  });
  const auto = await open({
    name: "Auto",
    type: "autoLoan",
    balance: 15000000,
    interest_rate: "4.5",
    minimum_payment: 350000,
  });
  const month = async (m = NOV) =>
    ((await (await json(`/api/v1/budgets/${bid}/months/${m}`)).json()) as Json).data;
  const cat = (await month()).groups
    .flatMap((g: Json) => g.categories)
    .find((c: Json) => c.name === "Mortgage Pay");
  expect(await rta(bid)).toBe(rtaBefore);
  await setAssigned(env, actor, {
    budget_id: bid,
    month: NOV,
    category_id: cat.id,
    assigned: 1500000,
  });
  const rtaAssigned = await rta(bid);
  expect(rtaAssigned).toBe(rtaBefore - 1500000); // assigning moves money; the loans did not
  return { bid, checking, mortgage, auto, cat, rtaBefore: rtaAssigned, month };
}
const rta = async (bid: string) =>
  ((await (await json(`/api/v1/budgets/${bid}/months/${NOV}`)).json()) as Json).data
    .ready_to_assign as number;
const pay = (bid: string, loan: string, body: Json) =>
  send(`/api/v1/budgets/${bid}/accounts/${loan}/payments`, "POST", body);
const activity = async (bid: string, loan: string, m?: string) => {
  const res = await json(
    `/api/v1/budgets/${bid}/accounts/${loan}/activity${m ? `?month=${m}` : ""}`,
  );
  expect(res.status).toBe(200);
  return LoanActivityResponse.parse(await res.json()).data;
};
const balance = async (bid: string, id: string) =>
  ((await (await json(`/api/v1/budgets/${bid}/accounts/${id}`)).json()) as Json).data.account
    .balance;

async function tool(name: string, args: Json) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
}

describe("AC1: a payment to the mortgage", () => {
  it("books interest and escrow as charges, the rest is principal: -199800000", async () => {
    const w = await world();
    const res = await pay(w.bid, w.mortgage.id, {
      from_account_id: w.checking.id,
      amount: 1500000,
      date: D15,
      memo: "ZZ-TEST pay",
    });
    expect(res.status).toBe(201);
    const a = await activity(w.bid, w.mortgage.id, NOV);
    expect(a.payments).toHaveLength(1);
    expect(a.payments[0]).toMatchObject({ amount: 1500000, memo: "ZZ-TEST pay" });
    expect(a.interest).toMatchObject({ amount: -1000000, state: "estimated" });
    expect(a.escrow).toMatchObject({ amount: -300000, state: "estimated" });
    expect(a.other).toHaveLength(1);
    expect(a.other[0]).toMatchObject({ amount: -200000000, label: "Initial Balance" });
    expect(a.principal).toBe(200000);
    expect(a.ending_balance).toBe(-199800000);
    expect(await balance(w.bid, w.mortgage.id)).toBe(-199800000);
  });
});

describe("AC2: a short payment on the auto loan", () => {
  it("leaves interest still due and the balance unchanged", async () => {
    const w = await world();
    const res = await send(`/api/v1/budgets/${w.bid}/transactions`, "POST", {
      account_id: w.checking.id,
      transfer_account_id: w.auto.id,
      amount: -50000,
      date: D15,
    });
    expect(res.status).toBe(201);
    const a = await activity(w.bid, w.auto.id, NOV);
    expect(a.interest).toMatchObject({ amount: -50000, still_due: 6250, estimated_total: -56250 });
    expect(a.escrow).toBeNull();
    const fmt = (n: number) => `$${(Math.abs(n) / 1000).toFixed(2)}`;
    expect(interestNote(a.interest as NonNullable<typeof a.interest>, fmt)).toBe(
      "Estimated, $6.25 still due ($56.25 total this month)",
    );
    expect(a.ending_balance).toBe(-15000000);
    expect(await balance(w.bid, w.auto.id)).toBe(-15000000);
  });
});

describe("AC3: a month without payments", () => {
  it("has no interest and no escrow lines", async () => {
    const w = await world();
    await pay(w.bid, w.mortgage.id, { from_account_id: w.checking.id, amount: 1500000, date: D15 });
    const dec = await activity(w.bid, w.mortgage.id, DEC);
    expect(dec).toMatchObject({
      payments: [],
      interest: null,
      escrow: null,
      ending_balance: -199800000,
    });
    const none = await activity(w.bid, w.auto.id, NOV);
    expect(none).toMatchObject({ payments: [], interest: null, escrow: null });
  });
});

describe("AC4: Record Payment", () => {
  it("defaults the amount to Available, categorizes the cash side, links the pair", async () => {
    const w = await world();
    const res = await pay(w.bid, w.mortgage.id, { from_account_id: w.checking.id, date: D15 });
    expect(res.status).toBe(201);
    const d = ((await res.json()) as Json).data;
    expect(d.amount).toBe(1500000);
    expect(d.from_transaction.category_id).toBe(w.cat.id);
    expect(d.to_transaction.category_id ?? null).toBeNull();
    expect(d.from_transaction.transfer_transaction_id).toBe(d.to_transaction.id);
    const m = await w.month();
    const c = m.groups.flatMap((g: Json) => g.categories).find((x: Json) => x.id === w.cat.id);
    expect(c.activity).toBe(-1500000);
    expect(c.available).toBe(0);
  });
  it("a deleted paired category leaves the cash side uncategorized", async () => {
    const w = await world();
    await env.DB.prepare("update categories set deleted_at = ? where id = ?")
      .bind(new Date().toISOString(), w.cat.id)
      .run();
    const res = await pay(w.bid, w.mortgage.id, {
      from_account_id: w.checking.id,
      amount: 100000,
      date: D15,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Json).data.from_transaction.category_id ?? null).toBeNull();
  });
  it("refuses: unpaired without amount, bad sources, non-loans", async () => {
    const w = await world();
    const r1 = await pay(w.bid, w.auto.id, { from_account_id: w.checking.id, date: D15 });
    expect(r1.status).toBe(422);
    expect(((await r1.json()) as Json).error.name).toBe("amount_required");
    const card = (
      (await (
        await send(`/api/v1/budgets/${w.bid}/accounts`, "POST", {
          name: `ZZ Card ${rand()}`,
          type: "creditCard",
          balance: 0,
          date: D15,
        })
      ).json()) as Json
    ).data.account;
    const asset = (
      (await (
        await send(`/api/v1/budgets/${w.bid}/accounts`, "POST", {
          name: `ZZ Asset ${rand()}`,
          type: "otherAsset",
          balance: 1000,
          date: D15,
        })
      ).json()) as Json
    ).data.account;
    for (const from of [card.id, asset.id, w.mortgage.id]) {
      const r = await pay(w.bid, w.mortgage.id, { from_account_id: from, amount: 1000, date: D15 });
      expect(r.status).toBe(422);
      expect(((await r.json()) as Json).error.name).toBe("invalid_payment_source");
    }
    const closed = (
      (await (
        await send(`/api/v1/budgets/${w.bid}/accounts`, "POST", {
          name: `ZZ Old ${rand()}`,
          type: "savings",
          balance: 0,
          date: D15,
        })
      ).json()) as Json
    ).data.account;
    await send(`/api/v1/budgets/${w.bid}/accounts/${closed.id}/close`, "POST", {});
    const rc = await pay(w.bid, w.mortgage.id, {
      from_account_id: closed.id,
      amount: 1000,
      date: D15,
    });
    expect(rc.status).toBe(422);
    expect(((await rc.json()) as Json).error.name).toBe("account_closed");
    const rn = await json(`/api/v1/budgets/${w.bid}/accounts/${w.checking.id}/activity`);
    expect(rn.status).toBe(422);
    expect(((await rn.json()) as Json).error.name).toBe("not_a_loan_account");
  });
  it("a card still pays through the same POST", async () => {
    const w = await world();
    const card = (
      (await (
        await send(`/api/v1/budgets/${w.bid}/accounts`, "POST", {
          name: `ZZ Card ${rand()}`,
          type: "creditCard",
          balance: 0,
          date: D15,
        })
      ).json()) as Json
    ).data.account;
    const r = await pay(w.bid, card.id, {
      from_account_id: w.checking.id,
      amount: 5000,
      date: D15,
    });
    expect(r.status).toBe(201);
  });
  it("last_payment_from_account_id follows the latest payment and a closed source", async () => {
    const w = await world();
    expect((await activity(w.bid, w.mortgage.id, NOV)).last_payment_from_account_id).toBeNull();
    await pay(w.bid, w.mortgage.id, { from_account_id: w.checking.id, amount: 1500000, date: D15 });
    expect((await activity(w.bid, w.mortgage.id, NOV)).last_payment_from_account_id).toBe(
      w.checking.id,
    );
    await env.DB.prepare("update accounts set closed = 1 where id = ?").bind(w.checking.id).run();
    expect((await activity(w.bid, w.mortgage.id, NOV)).last_payment_from_account_id).toBeNull();
  });
});

describe("AC5 / Acceptance 3: Ready to Assign", () => {
  it("never moves for loans, payments, charges or frozen rows", async () => {
    const w = await world();
    expect(await rta(w.bid)).toBe(w.rtaBefore);
    await pay(w.bid, w.mortgage.id, { from_account_id: w.checking.id, amount: 1500000, date: D15 });
    expect(await rta(w.bid)).toBe(w.rtaBefore);
    await freeze(w.bid, w.mortgage.id, "loan_interest", -1000000);
    await freeze(w.bid, w.mortgage.id, "loan_escrow", -300000);
    expect(await rta(w.bid)).toBe(w.rtaBefore);
  });
});

/** Writes a reconciled frozen row as EXF-543 will: a system payee, cleared reconciled. */
async function freeze(bid: string, loan: string, system: string, amount: number) {
  const now = new Date().toISOString();
  let p = (await q("select id from payees where budget_id = ? and system = ?", bid, system))[0]
    ?.id as string | undefined;
  if (!p) {
    p = crypto.randomUUID();
    await env.DB.prepare(
      "insert into payees (id, budget_id, name, system, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    )
      .bind(p, bid, system, system, now, now)
      .run();
  }
  await env.DB.prepare(
    `insert into transactions (id, budget_id, account_id, date, payee_id, amount, cleared, approved, created_at, updated_at, inflow_to_ready_to_assign)
     values (?, ?, ?, ?, ?, ?, 'reconciled', 1, ?, ?, 0)`,
  )
    .bind(crypto.randomUUID(), bid, loan, "2026-11-28", p, amount, now, now)
    .run();
}

describe("rule 8: reconciled lines stay", () => {
  it("deleting the payment keeps the frozen interest and escrow", async () => {
    const w = await world();
    const res = await pay(w.bid, w.mortgage.id, {
      from_account_id: w.checking.id,
      amount: 1500000,
      date: D15,
    });
    const d = ((await res.json()) as Json).data;
    await freeze(w.bid, w.mortgage.id, "loan_interest", -1000000);
    await freeze(w.bid, w.mortgage.id, "loan_escrow", -300000);
    let a = await activity(w.bid, w.mortgage.id, NOV);
    expect(a.interest).toMatchObject({ amount: -1000000, state: "reconciled" });
    expect(a.ending_balance).toBe(-199800000);
    const del = await send(
      `/api/v1/budgets/${w.bid}/transactions/${d.to_transaction.id}`,
      "DELETE",
    );
    expect(del.status).toBeLessThan(300);
    a = await activity(w.bid, w.mortgage.id, NOV);
    expect(a.payments).toHaveLength(0);
    expect(a.interest).toMatchObject({ amount: -1000000, state: "reconciled" });
    expect(a.escrow).toMatchObject({ amount: -300000, state: "reconciled" });
    expect(a.ending_balance).toBe(-201300000);
    expect(await balance(w.bid, w.mortgage.id)).toBe(-201300000);
  });
});

describe("balances: one derivation", () => {
  it("adjust and close of a loan with a payment land on the entered balance", async () => {
    const w = await world();
    await pay(w.bid, w.mortgage.id, { from_account_id: w.checking.id, amount: 1500000, date: D15 });
    const r = await send(
      `/api/v1/budgets/${w.bid}/accounts/${w.mortgage.id}/adjust-balance`,
      "POST",
      {
        balance: -190000000,
      },
    );
    expect(r.status).toBe(200);
    expect(await balance(w.bid, w.mortgage.id)).toBe(-190000000);
    const c = await send(`/api/v1/budgets/${w.bid}/accounts/${w.mortgage.id}/close`, "POST", {});
    expect(c.status).toBe(200);
    expect(await balance(w.bid, w.mortgage.id)).toBe(0);
  });
  it("the account summary includes the charges", async () => {
    const w = await world();
    const before = ((await (await json(`/api/v1/budgets/${w.bid}/account-summary`)).json()) as Json)
      .data;
    await pay(w.bid, w.mortgage.id, { from_account_id: w.checking.id, amount: 1500000, date: D15 });
    const after = ((await (await json(`/api/v1/budgets/${w.bid}/account-summary`)).json()) as Json)
      .data;
    // the payment moves cash and principal; the charges lower the total by 1,300,000
    expect(after.cleared + after.uncleared).toBe(before.cleared + before.uncleared - 1300000);
  });
});

describe("change_log and undo", () => {
  it("writes two transaction creates with the actor, and the change set undoes", async () => {
    const w = await world();
    const res = await pay(w.bid, w.mortgage.id, {
      from_account_id: w.checking.id,
      amount: 1500000,
      date: D15,
    });
    const logs = await q(
      "select actor, action, entity_type from change_log where budget_id = ? and entity_type = 'transaction' and action = 'create' and actor = ?",
      w.bid,
      actor,
    );
    // the two Starting Balance rows (checking, loans) plus the payment pair
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const u = await undo(w.bid, setOf(res));
    expect(u.status).toBe(200);
    const a = await activity(w.bid, w.mortgage.id, NOV);
    expect(a.payments).toEqual([]);
    expect(a.interest).toBeNull();
  });
});

describe("Acceptance 2: REST and MCP agree", () => {
  it("surface, get_loan_activity equals the GET, record_loan_payment makes the same rows", async () => {
    const w = await world();
    expect(await apiPaths()).toContain(
      "/api/v1/budgets/{budget_id}/accounts/{account_id}/activity",
    );
    const names = await listedToolNames();
    expect(names).toEqual(expect.arrayContaining(["get_loan_activity", "record_loan_payment"]));
    const r = await tool("record_loan_payment", {
      budget_id: w.bid,
      loan_account_id: w.mortgage.id,
      from_account_id: w.checking.id,
      amount: 1500000,
      date: D15,
    });
    expect(r.isError).not.toBe(true);
    expect(r.structuredContent.from_transaction.category_id).toBe(w.cat.id);
    const rest = await activity(w.bid, w.mortgage.id, NOV);
    const t = await tool("get_loan_activity", {
      budget_id: w.bid,
      loan_account_id: w.mortgage.id,
      month: NOV,
    });
    expect(t.structuredContent).toEqual(JSON.parse(JSON.stringify(rest)));
    const bad = await tool("get_loan_activity", {
      budget_id: w.bid,
      loan_account_id: w.checking.id,
    });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain("is not a loan account");
  });
});

// EXF-1006: a payment row names the account it came from, for Record Payment, a register transfer, REST and MCP.
describe("EXF-1006: payments name their source account", () => {
  it("Record Payment and a typed transfer both carry from_account_name, in REST and MCP", async () => {
    const w = await world();
    expect(
      (
        await pay(w.bid, w.mortgage.id, {
          from_account_id: w.checking.id,
          amount: 1000000,
          date: D15,
        })
      ).status,
    ).toBe(201);
    const typed = await send(`/api/v1/budgets/${w.bid}/transactions`, "POST", {
      account_id: w.checking.id,
      transfer_account_id: w.mortgage.id,
      amount: -500000,
      date: D15,
    });
    expect(typed.status).toBe(201);
    const a = await activity(w.bid, w.mortgage.id, NOV);
    expect(a.payments).toHaveLength(2);
    for (const p of a.payments) {
      expect(p.from_account_id).toBe(w.checking.id);
      expect(p.from_account_name).toBe(w.checking.name);
    }
    const res = await tool("get_loan_activity", {
      budget_id: w.bid,
      loan_account_id: w.mortgage.id,
      month: NOV,
    });
    const body = (res.structuredContent ?? JSON.parse(res.content[0].text)) as Json;
    const payments = (body.data ?? body).payments as Json[];
    expect(payments.map((p) => p.from_account_name)).toEqual([w.checking.name, w.checking.name]);
  });
});
