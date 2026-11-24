import { beforeEach, describe, expect, it } from "vitest";
import { tool } from "./account-helpers";
import { json } from "./helpers";
import { data, type Json, q, setupPlaid, TX } from "./plaid-sync-helpers";
import { liveRules, ruleLogs } from "./rename-rules-helpers";
import { PAYEES, setup, txn } from "./rename-rules-sync-helpers";

beforeEach(setupPlaid);

const patch = (plan: string, id: string, body: Json) =>
  json(`${TX(plan)}/${id}`, { method: "PATCH" }, body);
const rulesOf = async (plan: string) =>
  (await liveRules(plan)).map((r) => `${r.kind}:${r.text}`).sort();
const USER = "user:tester@localhost";

describe("renaming rules made by themselves (EXF-467)", () => {
  // 2.1: the fault this Build ends. Run before the fix it failed at the rule check:
  // `AssertionError: expected [] to deeply equal [ 'is:ZZ BANK CAFE 12' ]` (no rule made, so the next import made the payee again).
  it("a payee renamed in Manage Payees keeps its name on the next import of the bank's name", async () => {
    const s = await setup();
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK CAFE 12")] });
    const id = (await s.row("ZZ-1")).payee_id as string;
    const res = await json(`${PAYEES(s.plan)}/${id}`, { method: "PATCH" }, { name: "ZZ Cafe" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.payee.has_rules).toBe(true);
    expect(await rulesOf(s.plan)).toEqual(["is:ZZ BANK CAFE 12"]);
    const [log] = await ruleLogs(s.plan);
    expect(log).toMatchObject({ actor: USER, action: "create" });
    await s.bank({ added: [txn("ZZ-2", "ZZ BANK CAFE 12")] });
    expect(await s.row("ZZ-2")).toMatchObject({
      payee_id: id,
      payee_name: "ZZ Cafe",
      import_payee_name: "ZZ BANK CAFE 12",
    });
    expect(await s.payeeNames()).not.toContain("ZZ BANK CAFE 12");
  });

  it("a rename or a hide that has no imported row adds no rule; a second rename adds none twice", async () => {
    const s = await setup();
    const hand = await s.payee("ZZ Hand");
    expect(
      (await json(`${PAYEES(s.plan)}/${hand}`, { method: "PATCH" }, { name: "ZZ Hand 2" })).status,
    ).toBe(200);
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK X")] });
    const id = (await s.row("ZZ-1")).payee_id as string;
    expect(
      (await json(`${PAYEES(s.plan)}/${id}`, { method: "PATCH" }, { hidden: true })).status,
    ).toBe(200);
    expect(await rulesOf(s.plan)).toEqual([]);
    await json(`${PAYEES(s.plan)}/${id}`, { method: "PATCH" }, { name: "ZZ X One" });
    await json(`${PAYEES(s.plan)}/${id}`, { method: "PATCH" }, { name: "ZZ X Two" });
    // The second rename's old name ("ZZ X One") is no imported name: still the one rule.
    expect(await rulesOf(s.plan)).toEqual(["is:ZZ BANK X"]);
  });

  it("editing an imported row's payee learns `is <imported name>`; the next import follows it", async () => {
    const s = await setup();
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK CAFE 12")] });
    const row = await s.row("ZZ-1");
    expect((await patch(s.plan, row.id, { payee_name: "ZZ-TEST Coffee" })).status).toBe(200);
    const coffee = (
      await q("select id from payees where budget_id = ? and name = 'ZZ-TEST Coffee'", s.plan)
    )[0]?.id;
    expect(await rulesOf(s.plan)).toEqual(["is:ZZ BANK CAFE 12"]);
    const logs = await ruleLogs(s.plan);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actor: USER, action: "create" });
    expect(JSON.parse(logs[0]?.after_json)).toMatchObject({ payee_id: coffee, kind: "is" });
    await s.bank({ added: [txn("ZZ-2", "ZZ BANK CAFE 12")] });
    expect(await s.row("ZZ-2")).toMatchObject({
      payee_id: coffee,
      import_payee_name: "ZZ BANK CAFE 12",
    });
    const [c] = await q(
      "select actor, after_json from change_log where entity_type = 'transaction' and entity_id = ? and action = 'create'",
      (await s.row("ZZ-2")).id,
    );
    expect(c?.actor).toBe("service:plaid");
    expect(JSON.parse(c?.after_json).rename_rule_id).toBeTruthy();
    expect(JSON.parse(c?.after_json).import_payee_name).toBe("ZZ BANK CAFE 12");
  });

  it("learns by payee_id too, and through the tool with an mcp actor; no rule when the payee is the same", async () => {
    const s = await setup();
    const other = await s.payee("ZZ-TEST Other");
    await s.bank({ added: [txn("ZZ-1", "ZZ ONE"), txn("ZZ-2", "ZZ TWO")] });
    const r1 = await s.row("ZZ-1");
    const same = await patch(s.plan, r1.id, { payee_id: r1.payee_id, memo: "ZZ m" });
    expect(same.status).toBe(200);
    expect(await rulesOf(s.plan)).toEqual([]);
    expect((await patch(s.plan, r1.id, { payee_id: other })).status).toBe(200);
    const r2 = await s.row("ZZ-2");
    const res = await tool("update_transaction", {
      budget_id: s.plan,
      transaction_id: r2.id,
      payee_id: other,
    });
    expect(res.isError).not.toBe(true);
    expect(await rulesOf(s.plan)).toEqual(["is:ZZ ONE", "is:ZZ TWO"]);
    const logs = await ruleLogs(s.plan);
    expect(logs.map((l) => l.actor.startsWith("mcp:"))).toEqual([false, true]);
  });

  it("no rule: payee cleared, made a transfer, a hand row, split lines, Match, Unmatch", async () => {
    const s = await setup();
    await s.bank({
      added: [txn("ZZ-1", "ZZ ONE"), txn("ZZ-2", "ZZ TWO"), txn("ZZ-3", "ZZ THREE")],
    });
    const other = await s.payee("ZZ-TEST Other");
    const cleared = await patch(s.plan, (await s.row("ZZ-1")).id, { payee_id: null });
    expect(cleared.status).toBe(200);
    const acct2 = (
      await data(
        await json(
          `/api/v1/budgets/${s.plan}/accounts`,
          { method: "POST" },
          { name: "ZZ Savings", type: "savings", balance: 0 },
        ),
      )
    ).account.id as string;
    const t = await patch(s.plan, (await s.row("ZZ-2")).id, { transfer_account_id: acct2 });
    expect(t.status).toBe(200);
    const r3 = await s.row("ZZ-3");
    const split = await patch(s.plan, r3.id, {
      amount: r3.amount,
      subtransactions: [
        { amount: Math.round(r3.amount / 2), payee_id: other },
        { amount: r3.amount - Math.round(r3.amount / 2), payee_name: "ZZ Line" },
      ],
    });
    expect(split.status).toBe(200);
    expect(await rulesOf(s.plan)).toEqual([]);
    // A hand row has no imported name.
    const hand = (
      await q(
        "select id from transactions where budget_id = ? and source is null and payee_id is not null limit 1",
        s.plan,
      )
    )[0];
    expect((await patch(s.plan, hand?.id, { payee_id: other })).status).toBe(200);
    expect(await rulesOf(s.plan)).toEqual([]);
  });

  it("a second learn to a third payee: the newest correction is the only `is` rule left", async () => {
    const s = await setup();
    const a = await s.payee("ZZ-TEST A");
    const b = await s.payee("ZZ-TEST B");
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK CAFE 12")] });
    const r1 = await s.row("ZZ-1");
    await patch(s.plan, r1.id, { payee_id: a });
    await new Promise((ok) => setTimeout(ok, 3));
    await patch(s.plan, r1.id, { payee_id: b });
    await s.bank({ added: [txn("ZZ-2", "ZZ BANK CAFE 12")] });
    expect((await s.row("ZZ-2")).payee_id).toBe(b);
    // EXF-885: the payee left behind loses its rule, so exactly one payee holds `is <name>`.
    expect(await rulesOf(s.plan)).toEqual(["is:ZZ BANK CAFE 12"]);
  });

  it("undo: back to the imported name removes other payees' `is` rules; the next import keeps the name", async () => {
    const s = await setup();
    const cafe = await s.payee("ZZ Cafe", [["is", "ZZ BANK CAFE 12"]]);
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK CAFE 12")] });
    const r1 = await s.row("ZZ-1");
    expect(r1.payee_id).toBe(cafe);
    const res = await patch(s.plan, r1.id, { payee_name: "ZZ BANK CAFE 12" });
    expect(res.status).toBe(200);
    expect(await rulesOf(s.plan)).toEqual([]);
    const logs = await ruleLogs(s.plan);
    expect(logs.map((l) => [l.actor, l.action])).toEqual([
      [USER, "create"],
      [USER, "delete"],
    ]);
    expect(await s.payeeNames()).toContain("ZZ BANK CAFE 12");
    await s.bank({ added: [txn("ZZ-2", "ZZ BANK CAFE 12")] });
    expect((await s.row("ZZ-2")).payee_name).toBe("ZZ BANK CAFE 12");
    expect((await s.row("ZZ-2")).payee_id).toBe((await s.row("ZZ-1")).payee_id);
  });

  it("undo with a `contains` rule elsewhere still matching adds `is <name>` to the payee of that name", async () => {
    const s = await setup();
    await s.payee("ZZ Cafe", [["is", "ZZ BANK CAFE 12"]]);
    const other = await s.payee("ZZ Other", [["contains", "bank cafe"]]);
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK CAFE 12")] });
    const r1 = await s.row("ZZ-1");
    expect((await patch(s.plan, r1.id, { payee_name: "ZZ BANK CAFE 12" })).status).toBe(200);
    const named = (
      await q("select id from payees where budget_id = ? and name = 'ZZ BANK CAFE 12'", s.plan)
    )[0]?.id;
    expect((await liveRules(s.plan)).map((r) => [r.payee_id, r.kind])).toEqual(
      expect.arrayContaining([[named, "is"]]),
    );
    expect(await rulesOf(s.plan)).toEqual(["contains:bank cafe", "is:ZZ BANK CAFE 12"]);
    await s.bank({ added: [txn("ZZ-2", "ZZ BANK CAFE 12")] });
    expect((await s.row("ZZ-2")).payee_id).toBe(named);
    expect(named).not.toBe(other);
  });

  it("Match and Unmatch make no rule", async () => {
    const { sqlImport, post, MATCH, UNMATCH } = await import("./manual-match-helpers");
    const s = await setup();
    const hand = await s.payee("ZZ Hand");
    const [handRow] = await q("select id from transactions where payee_id = ?", hand);
    const imp = await sqlImport(s.plan, s.account, { payee_name: "ZZ MATCHED BANK" });
    const m = await post(MATCH(s.plan), { ids: [handRow?.id, imp.id] });
    expect(m.status).toBe(200);
    expect((await post(UNMATCH(s.plan, handRow?.id))).status).toBe(200);
    expect(await rulesOf(s.plan)).toEqual([]);
  });
});
