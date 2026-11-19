import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  createRenameRule,
  deleteRenameRule,
  listRenameRules,
  updateRenameRule,
} from "../src/services/payee-rename-rules";
import { applyToPayees, listPayees, updatePayee } from "../src/services/payees";
import { runSync } from "../src/services/plaid-sync";
import { updateTransaction } from "../src/services/transactions";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import {
  countingEnv,
  data,
  feed,
  hand,
  type Json,
  linked,
  q,
  REST_ACTOR,
  setupPlaid,
  stubBank,
  world,
} from "./plaid-sync-helpers";
import { addRule } from "./rename-rules-helpers";
import { setup, txn } from "./rename-rules-sync-helpers";

beforeEach(setupPlaid);

describe("renaming rules: D1 calls (EXF-467)", () => {
  it("one sync of two accounts with two entries and two rules on the plan: 13 D1, 2 Plaid", async () => {
    const calls = stubBank();
    const w = await world();
    const chk = await linked(w.plan, w.bank["ZZ Checking"] as string);
    await linked(w.plan, w.bank["ZZ Savings"] as string);
    for (const name of ["ZZ Cafe", "ZZ Rides"]) {
      await hand(w.plan, { account_id: chk, date: "2026-03-01", amount: -1000, payee_name: name });
    }
    const list = (await data(await json(`/api/v1/budgets/${w.plan}/payees`))).payees as Json[];
    const rule = async (name: string, kind: string, text: string) =>
      json(
        `/api/v1/budgets/${w.plan}/payees/${list.find((p) => p.name === name)?.id}/rename-rules`,
        { method: "POST" },
        { kind, text },
      );
    expect((await rule("ZZ Cafe", "is", "ZZ BANK CAFE 12")).status).toBe(201);
    expect((await rule("ZZ Rides", "contains", "zz ride")).status).toBe(201);
    feed.pages = [
      {
        added: [
          plaidTxn({
            transaction_id: "ZZ-C1",
            account_id: "acc-chk",
            merchant_name: "ZZ BANK CAFE 12",
          }),
          plaidTxn({ transaction_id: "ZZ-S1", account_id: "acc-sav", merchant_name: "ZZ RIDE 4" }),
        ],
      },
    ];
    const c = countingEnv();
    calls.length = 0;
    await runSync(c.env, w.conn);
    // The same count as without rules (link-status-calls.test.ts): the rules ride the plan's read batch.
    expect({ d1: c.calls.d1, plaid: calls.length }).toEqual({ d1: 13, plaid: 2 });
  });

  const calls = async (run: (e: Env) => Promise<unknown>) => {
    const c = countingEnv();
    await run(c.env);
    return c.calls.d1;
  };

  it("the edit of an imported row's payee: 8 D1 (learn) and 8 (undo with a contains rule elsewhere)", async () => {
    const s = await setup();
    await s.payee("ZZ Cafe", [["is", "ZZ BANK CAFE 12"]]);
    await s.payee("ZZ Other", [["contains", "bank cafe"]]);
    const pa = await s.payee("ZZ Coffee");
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK CAFE 12"), txn("ZZ-2", "ZZ BANK CAFE 99")] });
    const learn = (await s.row("ZZ-2")).id as string;
    expect(
      await calls((e) => updateTransaction(e, REST_ACTOR, s.plan, learn, { payee_id: pa })),
    ).toBe(8);
    const undo = (await s.row("ZZ-1")).id as string;
    expect(
      await calls((e) =>
        updateTransaction(e, REST_ACTOR, s.plan, undo, { payee_name: "ZZ BANK CAFE 12" }),
      ),
    ).toBe(8);
  });

  it("the payee rename with the rule made: 4 D1; the list: 3 D1 for 10 and 100 payees with rules", async () => {
    const s = await setup();
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK CAFE 12")] });
    const id = (await s.row("ZZ-1")).payee_id as string;
    expect(await calls((e) => updatePayee(e, REST_ACTOR, s.plan, id, { name: "ZZ Cafe" }))).toBe(4);
    expect(
      (await q("select count(*) n from payee_rename_rules where payee_id = ?", id))[0]?.n,
    ).toBe(1);
    const out: number[] = [];
    for (const n of [10, 100]) {
      const w = await setup();
      const ids = Array.from({ length: n }, () => crypto.randomUUID());
      const stmts = ids.flatMap((pid, i) => [
        env.DB.prepare(
          "insert into payees (id, budget_id, name, hidden, created_at, updated_at) values (?, ?, ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        ).bind(pid, w.plan, `ZZ L ${i}`),
        env.DB.prepare(
          "insert into payee_rename_rules (id, budget_id, payee_id, kind, text, match_text, created_at, updated_at) values (?, ?, ?, 'is', ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        ).bind(crypto.randomUUID(), w.plan, pid, `zz l ${i}`, `zz l ${i}`),
      ]);
      for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
      out.push(await calls((e) => listPayees(e, w.plan, { includeHidden: true })));
    }
    expect(out).toEqual([3, 3]);
  });

  it("rule list 3, create 3, update 4, delete 4; payee delete 3, and 4 with a replacement, with rules", async () => {
    const s = await setup();
    const a = await s.payee("ZZ A");
    const b = await s.payee("ZZ B");
    const r = await addRule(s.plan, a, "is", "zz a");
    expect(await calls((e) => listRenameRules(e, s.plan, a))).toBe(3);
    expect(
      await calls((e) =>
        createRenameRule(e, REST_ACTOR, s.plan, a, { kind: "contains", text: "zz a2" }),
      ),
    ).toBe(3);
    expect(
      await calls((e) => updateRenameRule(e, REST_ACTOR, s.plan, a, r.id, { text: "zz a3" })),
    ).toBe(4);
    expect(await calls((e) => deleteRenameRule(e, REST_ACTOR, s.plan, a, r.id))).toBe(4);
    const c = await s.payee("ZZ C", [["is", "zz c"]]);
    const d = await s.payee("ZZ D", [["is", "zz d"]]);
    expect(
      await calls((e) => applyToPayees(e, REST_ACTOR, s.plan, { ids: [c], action: "delete" })),
    ).toBe(3);
    expect(
      await calls((e) =>
        applyToPayees(e, REST_ACTOR, s.plan, { ids: [d], action: "delete", replacementId: b }),
      ),
    ).toBe(4);
  });
});
