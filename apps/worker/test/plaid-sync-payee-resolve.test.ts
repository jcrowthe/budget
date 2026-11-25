import { beforeEach, describe, expect, it } from "vitest";
import { q, setupPlaid } from "./plaid-sync-helpers";
import { setup, txn } from "./rename-rules-sync-helpers";

beforeEach(setupPlaid);

describe("the bank sync resolves payees like the file import (EXF-518)", () => {
  it("an existing payee matches by case-insensitive name: no second payee", async () => {
    const s = await setup();
    const existing = await s.payee("ZZ Phone Company LLC");
    await s.bank({ added: [txn("ZZ-1", "zz phone company llc")] });
    const r = await s.row("ZZ-1");
    expect(r).toMatchObject({ payee_id: existing, payee_name: "ZZ Phone Company LLC" });
    expect(r.import_payee_name).toBe("zz phone company llc");
    const names = (await s.payeeNames()).filter((n) => /phone company/i.test(n));
    expect(names).toEqual(["ZZ Phone Company LLC"]);
  });

  it("a new ALL-CAPS name is title-cased; a mixed-case name is unchanged", async () => {
    const s = await setup();
    await s.bank({ added: [txn("ZZ-1", "ZZ BRAND NEW VENDOR"), txn("ZZ-2", "ZZ McCafe")] });
    expect((await s.row("ZZ-1")).payee_name).toBe("Zz Brand New Vendor");
    expect((await s.row("ZZ-1")).import_payee_name).toBe("ZZ BRAND NEW VENDOR");
    expect((await s.row("ZZ-2")).payee_name).toBe("ZZ McCafe");
    const names = await s.payeeNames();
    expect(names).toContain("Zz Brand New Vendor");
    expect(names).not.toContain("ZZ BRAND NEW VENDOR");
  });

  it("later rows of the same folded name reuse the payee made in the run", async () => {
    const s = await setup();
    await s.bank({
      added: [
        txn("ZZ-1", "zz twice shop"),
        txn("ZZ-2", "ZZ TWICE SHOP"),
        txn("ZZ-3", "Zz Twice Shop"),
      ],
    });
    const ids = new Set<unknown>();
    for (const n of [1, 2, 3]) ids.add((await s.row(`ZZ-${n}`)).payee_id);
    expect(ids.size).toBe(1);
    expect((await s.payeeNames()).filter((n) => /twice shop/i.test(n))).toHaveLength(1);
  });

  it("a rule row keeps rename_rule_id in its change_log after", async () => {
    const s = await setup();
    const coffee = await s.payee("ZZ-TEST Coffee", [["is", "ZZ BANK CAFE 12"]]);
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK CAFE 12")] });
    const r = await s.row("ZZ-1");
    const [rule] = await q("select id from payee_rename_rules where payee_id = ?", coffee);
    const [log] = await q(
      "select after_json from change_log where entity_type = 'transaction' and entity_id = ? and action = 'create'",
      r.id,
    );
    expect(JSON.parse(log?.after_json)).toMatchObject({
      payee_id: coffee,
      rename_rule_id: rule?.id,
    });
  });
});
