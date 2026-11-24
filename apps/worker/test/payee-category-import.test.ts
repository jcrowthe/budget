import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import {
  data,
  feed,
  hand,
  imports,
  type Json,
  q,
  setupPlaid,
  stubBank,
  syncOne,
  TX,
  world1,
} from "./plaid-sync-helpers";
import { PAYEES, setup, txn } from "./rename-rules-sync-helpers";

beforeEach(setupPlaid);

async function cats(plan: string) {
  const g = (
    await data(
      await json(
        `/api/v1/budgets/${plan}/category_groups`,
        { method: "POST" },
        { name: "ZZ-TEST G" },
      ),
    )
  ).category_group as Json;
  const ids: Record<string, string> = {};
  for (const name of ["Groceries", "Fun", "Phone"]) {
    ids[name] = (
      await data(
        await json(
          `/api/v1/budgets/${plan}/categories`,
          { method: "POST" },
          { group_id: g.id, name: `ZZ-TEST ${name}` },
        ),
      )
    ).category.id as string;
  }
  return ids;
}

async function shop() {
  stubBank();
  const w = await world1();
  const c = await cats(w.plan);
  const row = (payee: string, date: string, category: string | null, amount = -5000) =>
    hand(w.plan, {
      account_id: w.account,
      date,
      amount,
      payee_name: payee,
      category_id: category ? c[category] : null,
    }).then((r) => expect(r.status).toBe(201));
  const patch = async (payee: string, body: Json) => {
    const list = (await data(await json(`${PAYEES(w.plan)}?include_hidden=true`))).payees as Json[];
    const id = list.find((p) => p.name === payee)?.id as string;
    const r = await json(`${PAYEES(w.plan)}/${id}`, { method: "PATCH" }, body);
    expect(r.status).toBe(200);
    return id;
  };
  let pages: Json[] = [];
  const bank = async (entries: Json[]) => {
    pages = [...pages, { added: entries }];
    feed.pages = pages as typeof feed.pages;
    return syncOne(w.plan, w.conn);
  };
  const imported = async (id: string) =>
    (await imports(w.account)).find((x) => x.import_id === id) as Json;
  return { ...w, c, row, patch, bank, imported };
}

const out = (id: string, merchant: string, over: Json = {}) =>
  plaidTxn({ transaction_id: id, merchant_name: merchant, amount: 12.34, ...over });

describe("the bank import uses the payee's effective default (EXF-515 U3)", () => {
  it("ZZ Shop: Groceries, Groceries, Fun gives Groceries", async () => {
    const s = await shop();
    await s.row("ZZ Shop", "2026-11-10", "Groceries");
    await s.row("ZZ Shop", "2026-11-11", "Groceries");
    await s.row("ZZ Shop", "2026-11-12", "Fun");
    await s.bank([out("ZZ-1", "ZZ Shop", { date: "2026-11-13" })]);
    expect((await s.imported("ZZ-1")).category_id).toBe(s.c.Groceries);
  });

  it("a fixed payee gets its fixed category, whatever its history", async () => {
    const s = await shop();
    await s.row("ZZ Phone Co", "2026-11-10", "Phone");
    await s.patch("ZZ Phone Co", { category_mode: "fixed", fixed_category_id: s.c.Fun });
    await s.bank([out("ZZ-1", "ZZ Phone Co", { date: "2026-11-13" })]);
    expect((await s.imported("ZZ-1")).category_id).toBe(s.c.Fun);
  });

  it("`off` gets no category on an outflow; an inflow into checking still gets Ready to Assign", async () => {
    const s = await shop();
    await s.row("ZZ Off Co", "2026-11-10", "Groceries");
    await s.patch("ZZ Off Co", { category_mode: "off" });
    await s.bank([
      out("ZZ-1", "ZZ Off Co", { date: "2026-11-13" }),
      out("ZZ-2", "ZZ Off Co", { date: "2026-11-14", amount: -77.7 }),
    ]);
    expect(await s.imported("ZZ-1")).toMatchObject({
      category_id: null,
      inflow_to_ready_to_assign: 0,
    });
    expect(await s.imported("ZZ-2")).toMatchObject({
      category_id: null,
      inflow_to_ready_to_assign: 1,
    });
  });

  it("a brand-new payee gets no category and is listed as needing one", async () => {
    const s = await shop();
    await s.bank([out("ZZ-1", "ZZ-TEST New Store", { date: "2026-11-13" })]);
    const r = await s.imported("ZZ-1");
    expect(r.category_id).toBeNull();
    const list = (await data(await json(`${TX(s.plan)}?needs=approval_or_category`)))
      .transactions as Json[];
    expect(list.find((t) => t.id === r.id)).toMatchObject({ category_id: null });
  });

  it("a row renamed by a rule gets the rule payee's default", async () => {
    const s = await setup();
    const c = await cats(s.plan);
    const rule = await s.payee("ZZ-TEST Rule Payee", [["is", "ZZ BANK RULE"]]);
    for (const [d, cat] of [
      ["2026-11-10", "Groceries"],
      ["2026-11-11", "Groceries"],
      ["2026-11-12", "Fun"],
    ] as const) {
      const r = await hand(s.plan, {
        account_id: s.account,
        date: d,
        amount: -5000,
        payee_id: rule,
        category_id: c[cat],
      });
      expect(r.status).toBe(201);
    }
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK RULE", { date: "2026-11-13" })] });
    const r = await s.row("ZZ-1");
    expect(r.payee_id).toBe(rule);
    expect(r.category_id).toBe(c.Groceries);
  });
});

describe("a sync keeps the stored defaults of the payees it touched current (EXF-515 U3)", () => {
  const stored = async (plan: string, name: string) =>
    (await q(
      "select default_category_id c, default_inflow_to_ready_to_assign r from payees where budget_id = ? and name = ?",
      plan,
      name,
    ))[0] as Json;
  const patchTx = (plan: string, id: string, body: Json) =>
    json(`${TX(plan)}/${id}`, { method: "PATCH" }, body);

  it("two imported rows categorized Fun, then a third imported: Fun", async () => {
    const s = await shop();
    await s.bank([
      out("ZZ-1", "ZZ P", { date: "2026-11-10", amount: 1.11 }),
      out("ZZ-2", "ZZ P", { date: "2026-11-11", amount: 2.22 }),
    ]);
    for (const id of ["ZZ-1", "ZZ-2"]) {
      const r = await patchTx(s.plan, (await s.imported(id)).id, { category_id: s.c.Fun });
      expect(r.status).toBe(200);
    }
    await s.bank([out("ZZ-3", "ZZ P", { date: "2026-11-12", amount: 3.33 })]);
    expect((await s.imported("ZZ-3")).category_id).toBe(s.c.Fun);
    expect((await stored(s.plan, "ZZ P")).c).toBe(s.c.Fun);
  });

  it("the final batch recomputes: a stale stored default is replaced; a new payee's inflow stores RTA", async () => {
    const s = await shop();
    await s.row("ZZ P", "2026-11-09", "Fun");
    await s.row("ZZ P", "2026-11-10", "Fun");
    await env.DB.prepare(
      "update payees set default_category_id = ? where budget_id = ? and name = 'ZZ P'",
    )
      .bind(s.c.Groceries, s.plan)
      .run();
    await s.bank([
      out("ZZ-1", "ZZ P", { date: "2026-11-12", amount: 3.33 }),
      out("ZZ-2", "ZZ Payer", { date: "2026-11-12", amount: -9.99 }),
    ]);
    // the defaults read at the start of the sync (stale: Groceries) apply to its rows
    expect((await s.imported("ZZ-1")).category_id).toBe(s.c.Groceries);
    // then the stored default follows the rule: last three are Groceries, Fun, Fun
    expect((await stored(s.plan, "ZZ P")).c).toBe(s.c.Fun);
    expect((await s.imported("ZZ-2")).inflow_to_ready_to_assign).toBe(1);
    expect((await stored(s.plan, "ZZ Payer")).r).toBe(1);
  });

  it("two new entries for one payee in one sync both get the default read at its start", async () => {
    const s = await shop();
    await s.row("ZZ P", "2026-11-10", "Fun");
    await s.bank([
      out("ZZ-1", "ZZ P", { date: "2026-11-12", amount: 1.11 }),
      out("ZZ-2", "ZZ P", { date: "2026-11-13", amount: 2.22 }),
    ]);
    expect((await s.imported("ZZ-1")).category_id).toBe(s.c.Fun);
    expect((await s.imported("ZZ-2")).category_id).toBe(s.c.Fun);
  });
});
