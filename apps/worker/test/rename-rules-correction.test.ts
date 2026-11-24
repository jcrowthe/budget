import { beforeEach, describe, expect, it } from "vitest";
import { updateTransaction } from "../src/services/transactions";
import { json } from "./helpers";
import { countingEnv, q, REST_ACTOR, setupPlaid, TX } from "./plaid-sync-helpers";
import { liveRules, ruleLogs } from "./rename-rules-helpers";
import { setup, txn } from "./rename-rules-sync-helpers";

beforeEach(setupPlaid);

const USER = "user:tester@localhost";

describe("a correction wins over an older `is` rule (EXF-885)", () => {
  it("correcting an imported row to P sends the next import to P, though Q's `is` rule is newer", async () => {
    const s = await setup();
    const name = "ZZ BANK CAFE 12";
    await s.bank({ added: [txn("ZZ-1", name)] });
    const p = await s.payee("ZZ-TEST P", [["is", name]]);
    const qq = await s.payee("ZZ-TEST Q", [["is", name]]);
    await s.bank({ added: [txn("ZZ-2", name)] });
    expect((await s.row("ZZ-2")).payee_id).toBe(qq);

    const res = await json(
      `${TX(s.plan)}/${(await s.row("ZZ-2")).id}`,
      { method: "PATCH" },
      { payee_id: p },
    );
    expect(res.status).toBe(200);

    await s.bank({ added: [txn("ZZ-3", name)] });
    expect((await s.row("ZZ-3")).payee_id).toBe(p);

    const live = await liveRules(s.plan);
    expect(live.filter((r) => r.payee_id === p)).toHaveLength(1);
    expect(live.filter((r) => r.payee_id === qq)).toHaveLength(0);
    const [gone] = await q(
      "select deleted_at from payee_rename_rules where budget_id = ? and payee_id = ?",
      s.plan,
      qq,
    );
    expect(gone?.deleted_at).toBeTruthy();
    const dels = (await ruleLogs(s.plan)).filter((l) => l.action === "delete");
    expect(dels).toHaveLength(1);
    expect(dels[0]).toMatchObject({ actor: USER });
    expect(JSON.parse(dels[0]?.before_json as string)).toMatchObject({ payee_id: qq, kind: "is" });
  });

  it("the transaction edit stays at 8 D1 calls when it removes another payee's rule", async () => {
    const s = await setup();
    const name = "ZZ BANK CAFE 12";
    await s.bank({ added: [txn("ZZ-1", name)] });
    const p = await s.payee("ZZ-TEST P", [["is", name]]);
    await s.payee("ZZ-TEST Q", [["is", name]]);
    await s.bank({ added: [txn("ZZ-2", name)] });
    const c = countingEnv();
    await updateTransaction(c.env, REST_ACTOR, s.plan, (await s.row("ZZ-2")).id as string, {
      payee_id: p,
    });
    expect(c.calls.d1).toBe(8);
  });
});
