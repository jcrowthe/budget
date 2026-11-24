import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { matchTransactions, unmatchTransaction } from "../src/services/manual-match";
import { enterDue } from "../src/services/scheduled-transactions";
import { account, data, send } from "./account-helpers";
import { json } from "./helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";
import { sqlImport } from "./manual-match-helpers";
import { REST_ACTOR, setupPlaid, stubBank, world1 } from "./plaid-sync-helpers";
import { importForm, postImport, sampleZip, SAMPLE_ZIP_NAME } from "./plan-import-helpers";
import { pinPlanClock } from "./plan-export-helpers";
import { setNext, TODAY } from "./scheduled-helpers";
import { mcpRpc } from "./surface";

const ACTOR = REST_ACTOR;
const B = (bid: string) => `/api/v1/budgets/${bid}`;

async function world() {
  const w = await payeeWorld();
  const g = (await data(await send(`${B(w.bid)}/category_groups`, "POST", { name: "ZZ-TEST G" })))
    .category_group as Json;
  const ids: Record<string, string> = {};
  for (const name of ["Fun", "Groceries", "Rent"]) {
    ids[name] = (
      await data(
        await send(`${B(w.bid)}/categories`, "POST", { group_id: g.id, name: `ZZ-TEST ${name}` }),
      )
    ).category.id as string;
  }
  const stored = async (name: string) =>
    env.DB.prepare(
      "select default_category_id c, default_inflow_to_ready_to_assign r from payees where budget_id = ? and name = ?",
    )
      .bind(w.bid, name)
      .first<Json>();
  /** Makes the stored default stale (another live category) so only a recompute can fix it. */
  const stale = async (name: string, to = ids.Rent) => {
    await env.DB.prepare(
      "update payees set default_category_id = ?, default_inflow_to_ready_to_assign = 0 where budget_id = ? and name = ?",
    )
      .bind(to, w.bid, name)
      .run();
    expect((await stored(name))?.c).toBe(to);
  };
  const row = (payee: string, date: string, cat: string, over: Json = {}) =>
    w.tx(payee, { date, category_id: ids[cat], ...over });
  return { ...w, ids, stored, stale, row };
}

describe("every writer keeps the stored default current (EXF-515 U3)", () => {
  it("bulk categorize of two of three Groceries rows to Fun gives Fun", async () => {
    const s = await world();
    const t = [
      await s.row("ZZ P", "2026-11-01", "Groceries"),
      await s.row("ZZ P", "2026-11-02", "Groceries"),
      await s.row("ZZ P", "2026-11-03", "Groceries"),
    ];
    expect((await s.stored("ZZ P"))?.c).toBe(s.ids.Groceries);
    const res = await send(`${B(s.bid)}/transactions/bulk`, "POST", {
      op: "categorize",
      ids: [t[1]?.id, t[2]?.id],
      value: s.ids.Fun,
    });
    expect(res.status).toBe(200);
    expect((await s.stored("ZZ P"))?.c).toBe(s.ids.Fun);
  });

  for (const op of ["delete", "duplicate", "move"] as const) {
    it(`bulk ${op} recomputes`, async () => {
      const s = await world();
      const a = await s.row("ZZ P", "2026-11-01", "Groceries");
      await s.row("ZZ P", "2026-11-02", "Groceries");
      const c = await s.row("ZZ P", "2026-11-03", "Fun");
      await s.stale("ZZ P");
      const other = (await account(s.bid, "checking", 100000, "ZZ Other")).id as string;
      const body =
        op === "delete"
          ? { op, ids: [c.id] }
          : op === "move"
            ? { op, ids: [a.id], value: other }
            : { op, ids: [a.id] };
      const res = await send(`${B(s.bid)}/transactions/bulk`, "POST", body);
      expect(res.status).toBe(200);
      expect((await s.stored("ZZ P"))?.c).toBe(s.ids.Groceries);
    });
  }

  describe("match and unmatch", () => {
    async function pair() {
      await setupPlaid();
      stubBank();
      const w = await world1();
      const g = (
        await data(
          await json(`${B(w.plan)}/category_groups`, { method: "POST" }, { name: "ZZ-TEST G" }),
        )
      ).category_group as Json;
      const mk = async (name: string) =>
        (
          await data(
            await json(
              `${B(w.plan)}/categories`,
              { method: "POST" },
              { group_id: g.id, name: `ZZ-TEST ${name}` },
            ),
          )
        ).category.id as string;
      const groceries = await mk("Groceries");
      const rent = await mk("Rent");
      const hand = async (date: string, amount: number) =>
        (
          await data(
            await json(
              `${B(w.plan)}/transactions`,
              { method: "POST" },
              {
                account_id: w.account,
                date,
                amount,
                payee_name: "ZZ Cafe",
                category_id: groceries,
              },
            ),
          )
        ).transaction.id as string;
      await hand("2026-03-14", -100);
      await hand("2026-03-15", -200);
      const entry = await hand("2026-03-12", -12340);
      const imp = (await sqlImport(w.plan, w.account, { amount: -13000 })).id;
      const stale = () =>
        env.DB.prepare(
          "update payees set default_category_id = ? where budget_id = ? and name = 'ZZ Cafe'",
        )
          .bind(rent, w.plan)
          .run();
      const stored = async () =>
        (
          await env.DB.prepare(
            "select default_category_id c from payees where budget_id = ? and name = 'ZZ Cafe'",
          )
            .bind(w.plan)
            .first<Json>()
        )?.c as string;
      return { ...w, entry, imp, groceries, stale, stored };
    }

    it("match recomputes", async () => {
      const s = await pair();
      await s.stale();
      await matchTransactions(env, ACTOR, s.plan, [s.entry, s.imp]);
      expect(await s.stored()).toBe(s.groceries);
    });

    it("unmatch recomputes", async () => {
      const s = await pair();
      await matchTransactions(env, ACTOR, s.plan, [s.entry, s.imp]);
      await s.stale();
      await unmatchTransaction(env, ACTOR, s.plan, s.entry);
      expect(await s.stored()).toBe(s.groceries);
    });
  });

  describe("an entered schedule", () => {
    const input = (s: Json, over: Json = {}) => ({
      account_id: s.acct,
      date_first: "2099-01-15",
      frequency: "monthly",
      amount: -4000,
      payee_name: "ZZ P",
      category_id: s.ids.Groceries,
      ...over,
    });
    const make = async (s: Json, over: Json = {}) => {
      const res = await send(`${B(s.bid)}/scheduled-transactions?today=${TODAY}`, "POST", input(s, over));
      expect(res.status).toBe(201);
      return (await data(res)).scheduled_transaction as Json;
    };
    async function seeded() {
      const s = await world();
      await s.row("ZZ P", "2026-11-01", "Groceries");
      await s.row("ZZ P", "2026-11-02", "Groceries");
      await s.stale("ZZ P", s.ids.Fun);
      return s;
    }

    it("enterDue recomputes", async () => {
      const s = await seeded();
      const sc = await make(s);
      await setNext(sc.id, "2026-11-10");
      const r = await enterDue(env, { budgetIds: [s.bid], day: "2026-11-16", actor: "service:scheduler" });
      expect(r.entered).toHaveLength(1);
      expect((await s.stored("ZZ P"))?.c).toBe(s.ids.Groceries);
    });

    it("enter_now recomputes", async () => {
      const s = await seeded();
      const sc = await make(s);
      const res = await send(`${B(s.bid)}/scheduled-transactions/bulk?today=${TODAY}`, "POST", {
        op: "enter_now",
        ids: [sc.id],
      });
      expect(res.status).toBe(201);
      expect((await s.stored("ZZ P"))?.c).toBe(s.ids.Groceries);
    });

    it("a schedule created with a date that enters now recomputes", async () => {
      const s = await seeded();
      await make(s, { date_first: TODAY });
      expect((await s.stored("ZZ P"))?.c).toBe(s.ids.Groceries);
    });
  });

  it("a plan import stores the defaults of its payees", async () => {
    pinPlanClock();
    const res = await postImport(
      importForm([{ name: SAMPLE_ZIP_NAME, data: await sampleZip() }]),
    );
    const bid = ((await res.json()) as Json).data.budget_id as string;
    const rows = (
      await env.DB.prepare(
        "select name, default_category_id c, default_inflow_to_ready_to_assign r from payees where budget_id = ? and name in ('Landlord', 'Employer')",
      )
        .bind(bid)
        .all<Json>()
    ).results;
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.Landlord?.c).not.toBeNull();
    expect(by.Employer?.r).toBe(1);
  });
});

describe("a create with no category keys takes the payee's default (Q3, EXF-515 U3)", () => {
  async function q3() {
    const s = await world();
    await s.row("ZZ P", "2026-11-01", "Fun");
    await s.row("ZZ P", "2026-11-02", "Fun");
    const rest = async (body: Json) => {
      const res = await send(`${B(s.bid)}/transactions`, "POST", {
        account_id: s.acct,
        date: "2026-11-10",
        amount: -1000,
        ...body,
      });
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
      return (await data(res)).transaction as Json;
    };
    const mcp = async (body: Json) => {
      await mcpRpc(
        "initialize",
        { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        1,
      );
      const r = (
        await mcpRpc(
          "tools/call",
          {
            name: "create_transaction",
            arguments: {
              budget_id: s.bid,
              account_id: s.acct,
              date: "2026-11-10",
              amount: -1000,
              ...body,
            },
          },
          2,
        )
      ).body.result as Json;
      expect(r.isError, JSON.stringify(r)).toBeFalsy();
      return (r.structuredContent?.transaction ?? JSON.parse(r.content[0].text).transaction) as Json;
    };
    return { ...s, rest, mcp, pid: await s.id("ZZ P") };
  }

  for (const via of ["rest", "mcp"] as const) {
    describe(via, () => {
      it("no category keys: the default; null or false: none", async () => {
        const s = await q3();
        const go = s[via];
        expect((await go({ payee_id: s.pid })).category_id).toBe(s.ids.Fun);
        expect((await go({ payee_name: "ZZ P" })).category_id).toBe(s.ids.Fun);
        expect((await go({ payee_id: s.pid, category_id: null })).category_id).toBeNull();
        const f = await go({ payee_id: s.pid, inflow_to_ready_to_assign: false });
        expect(f.category_id).toBeNull();
      });

      it("a fixed Ready to Assign payee gives inflow_to_ready_to_assign", async () => {
        const s = await q3();
        const res = await send(`${P(s.bid)}/${s.pid}`, "PATCH", {
          category_mode: "fixed",
          fixed_inflow_to_ready_to_assign: true,
        });
        expect(res.status).toBe(200);
        const t = await s[via]({ payee_id: s.pid, amount: 1000 });
        expect(t.inflow_to_ready_to_assign).toBe(true);
        expect(t.category_id).toBeNull();
      });

      it("an off payee and a new payee get none", async () => {
        const s = await q3();
        expect((await s[via]({ payee_name: "ZZ New" })).category_id).toBeNull();
        await send(`${P(s.bid)}/${s.pid}`, "PATCH", { category_mode: "off" });
        expect((await s[via]({ payee_id: s.pid })).category_id).toBeNull();
      });

      it("a split, an on-plan transfer and a tracking account get none", async () => {
        const s = await q3();
        const other = (await account(s.bid, "checking", 100000, "ZZ Other")).id as string;
        const asset = (await account(s.bid, "otherAsset", 100000, "ZZ Asset")).id as string;
        const split = await s[via]({
          payee_id: s.pid,
          amount: -3000,
          subtransactions: [
            { amount: -1000, category_id: s.ids.Rent },
            { amount: -2000, category_id: s.ids.Rent },
          ],
        });
        expect(split.category_id).toBeNull();
        const xfer = await s[via]({ transfer_account_id: other });
        expect(xfer.category_id).toBeNull();
        const track = await s[via]({ account_id: asset, payee_id: s.pid });
        expect(track.category_id).toBeNull();
        expect(track.inflow_to_ready_to_assign ?? false).toBe(false);
      });
    });
  }

  it("the create_transaction description says so", async () => {
    await mcpRpc(
      "initialize",
      { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      1,
    );
    const tools = (await mcpRpc("tools/list", {}, 3)).body.result as Json;
    const d = tools.tools.find((t: Json) => t.name === "create_transaction").description as string;
    expect(d).toContain("takes its payee's default");
  });
});
