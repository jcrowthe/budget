import { beforeEach, describe, expect, it } from "vitest";
import { json } from "./helpers";
import { data, hand, type Json, q, setupPlaid, TX } from "./plaid-sync-helpers";
import { PAYEES, setup, txn } from "./rename-rules-sync-helpers";

beforeEach(setupPlaid);

describe("the import applies renaming rules (EXF-467)", () => {
  it("an `is` rule gives the payee; the imported name is kept as received; history shows the rule", async () => {
    const s = await setup();
    const coffee = await s.payee("ZZ-TEST Coffee", [["is", "ZZ BANK CAFE 12"]]);
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK CAFE 12")] });
    const r = await s.row("ZZ-1");
    expect(r).toMatchObject({
      payee_id: coffee,
      payee_name: "ZZ-TEST Coffee",
      import_payee_name: "ZZ BANK CAFE 12",
    });
    expect(await s.payeeNames()).not.toContain("ZZ BANK CAFE 12");
    const [rule] = await q("select id from payee_rename_rules where payee_id = ?", coffee);
    const [log] = await q(
      "select actor, after_json from change_log where entity_type = 'transaction' and entity_id = ? and action = 'create'",
      r.id,
    );
    expect(log?.actor).toBe("service:plaid");
    expect(JSON.parse(log?.after_json)).toMatchObject({
      payee_id: coffee,
      rename_rule_id: rule?.id,
    });
  });

  it("no rule: the payee of the bank's name is made, as before; no rename_rule_id", async () => {
    const s = await setup();
    await s.bank({ added: [txn("ZZ-1", "ZZ PLAIN")] });
    expect(await s.payeeNames()).toContain("ZZ PLAIN");
    const [log] = await q(
      "select after_json from change_log where entity_type = 'transaction' and entity_id = ?",
      (await s.row("ZZ-1")).id,
    );
    expect(JSON.parse(log?.after_json).rename_rule_id).toBeUndefined();
  });

  it("contains: any case, words in order; several rules of a payee are OR-ed", async () => {
    const s = await setup();
    const rides = await s.payee("ZZ-TEST Rides", [
      ["contains", "uber"],
      ["contains", "lyft"],
    ]);
    const other = await s.payee("ZZ-TEST Other", [["contains", "uber eats"]]);
    await s.bank({
      added: [
        txn("ZZ-1", "UBER TRIP"),
        txn("ZZ-2", "Uber Eats Order"),
        txn("ZZ-3", "EATS UBER"),
        txn("ZZ-4", "my lyft ride"),
        txn("ZZ-5", "ZZ NOTHING"),
      ],
    });
    // "Uber Eats Order" matches both payees' contains rules: the newer (ZZ-TEST Other) wins.
    expect((await s.row("ZZ-1")).payee_id).toBe(rides);
    expect((await s.row("ZZ-2")).payee_id).toBe(other);
    expect((await s.row("ZZ-3")).payee_id).toBe(rides);
    expect((await s.row("ZZ-4")).payee_id).toBe(rides);
    expect((await s.row("ZZ-5")).payee_name).toBe("ZZ NOTHING");
  });

  it("two payees with the same rule: the newer rule wins; an `is` beats both", async () => {
    const s = await setup();
    await s.payee("ZZ-TEST Old", [["contains", "zz shop"]]);
    const newer = await s.payee("ZZ-TEST New", [["contains", "zz shop"]]);
    const exact = await s.payee("ZZ-TEST Exact", [["is", "ZZ SHOP 9"]]);
    await s.bank({ added: [txn("ZZ-1", "ZZ SHOP 1"), txn("ZZ-2", "ZZ SHOP 9")] });
    expect((await s.row("ZZ-1")).payee_id).toBe(newer);
    expect((await s.row("ZZ-2")).payee_id).toBe(exact);
  });

  it("a hidden payee's rule applies and the payee stays hidden; a deleted payee's rule does not", async () => {
    const s = await setup();
    const hidden = await s.payee("ZZ-TEST Hidden", [["is", "ZZ H"]]);
    const gone = await s.payee("ZZ-TEST Gone", [["is", "ZZ G"]]);
    expect(
      (await json(`${PAYEES(s.plan)}/${hidden}`, { method: "PATCH" }, { hidden: true })).status,
    ).toBe(200);
    expect((await json(`${PAYEES(s.plan)}/${gone}`, { method: "DELETE" })).status).toBe(200);
    await s.bank({ added: [txn("ZZ-1", "ZZ H"), txn("ZZ-2", "ZZ G")] });
    expect((await s.row("ZZ-1")).payee_id).toBe(hidden);
    const [h] = await q("select hidden from payees where id = ?", hidden);
    expect(h?.hidden).toBe(1);
    expect((await s.row("ZZ-2")).payee_name).toBe("ZZ G");
    expect(await s.payeeNames()).toContain("ZZ G");
  });

  it("non-ASCII: CAFÉ ZZ matches `contains café`", async () => {
    const s = await setup();
    const cafe = await s.payee("ZZ-TEST Cafe", [["contains", "café"]]);
    await s.bank({ added: [txn("ZZ-1", "CAFÉ ZZ")] });
    expect((await s.row("ZZ-1")).payee_id).toBe(cafe);
  });

  it("the rule payee's last category gives the row's category", async () => {
    const s = await setup();
    const m = await data(await json(`/api/v1/budgets/${s.plan}/months/2026-03-01`));
    const cat = m.groups.flatMap((g: Json) => g.categories)[0].id as string;
    expect(cat).toBeTruthy();
    const res = await hand(s.plan, {
      account_id: s.account,
      date: "2026-03-02",
      amount: -2000,
      payee_name: "ZZ-TEST Cat",
      category_id: cat,
    });
    expect(res.status).toBe(201);
    const id = ((await data(await json(`${PAYEES(s.plan)}`))).payees as Json[]).find(
      (p) => p.name === "ZZ-TEST Cat",
    )?.id;
    await json(
      `${PAYEES(s.plan)}/${id}/rename-rules`,
      { method: "POST" },
      { kind: "is", text: "ZZ CAT BANK" },
    );
    await s.bank({ added: [txn("ZZ-1", "ZZ CAT BANK")] });
    expect((await s.row("ZZ-1")).category_id).toBe(cat);
  });

  it("follow: an untouched unapproved import takes the rule's payee when the bank's name changes", async () => {
    const s = await setup();
    const coffee = await s.payee("ZZ-TEST Coffee", [["is", "ZZ NEW NAME"]]);
    const t = txn("ZZ-1", "ZZ OLD NAME");
    await s.bank({ added: [t] });
    expect((await s.row("ZZ-1")).payee_name).toBe("ZZ OLD NAME");
    await s.bank({ modified: [{ ...t, merchant_name: "ZZ NEW NAME" }] });
    expect(await s.row("ZZ-1")).toMatchObject({
      payee_id: coffee,
      payee_name: "ZZ-TEST Coffee",
      import_payee_name: "ZZ NEW NAME",
    });
    const logs = await q(
      "select after_json from change_log where entity_type = 'transaction' and entity_id = ? and action = 'update'",
      (await s.row("ZZ-1")).id,
    );
    expect(JSON.parse(logs.at(-1)?.after_json).rename_rule_id).toBeTruthy();
  });

  it("a row the owner set by hand is not moved by a rule", async () => {
    const s = await setup();
    await s.payee("ZZ-TEST Other", [["contains", "zz changed"]]);
    const t = txn("ZZ-1", "ZZ FIRST");
    await s.bank({ added: [t] });
    const id = (await s.row("ZZ-1")).id as string;
    const res = await json(`${TX(s.plan)}/${id}`, { method: "PATCH" }, { payee_name: "ZZ Mine" });
    expect(res.status).toBe(200);
    await s.bank({ modified: [{ ...t, merchant_name: "ZZ CHANGED NAME" }] });
    const r = await s.row("ZZ-1");
    expect(r.payee_name).toBe("ZZ Mine");
    expect(r.import_payee_name).toBe("ZZ CHANGED NAME");
  });
});
