import { PAYEE_ERRORS } from "@budget/schema/payees";
import { transferPayeeId } from "@budget/schema/transfers";
import { beforeEach, describe, expect, it } from "vitest";
import { account, data, plan, send } from "./account-helpers";
import { json } from "./helpers";
import { type Json, P } from "./manage-payees-helpers";
import { data as plaidData, q, setupPlaid } from "./plaid-sync-helpers";
import { liveRules, RR } from "./rename-rules-helpers";
import { setup, txn } from "./rename-rules-sync-helpers";

describe("renaming rules on a transfer payee (EXF-885)", () => {
  it("creates, lists, updates and deletes a rule on a transfer payee", async () => {
    const bid = await plan();
    const acct = await account(bid, "checking", 0, "ZZ-TEST Card");
    const tid = transferPayeeId(acct.id);
    const created = await send(RR(bid, tid), "POST", { kind: "contains", text: "ZZ Card Pay" });
    expect(created.status).toBe(201);
    const rule = (await data(created)).rule as Json;
    expect(rule).toMatchObject({ payee_id: tid, kind: "contains", text: "ZZ Card Pay" });
    expect(
      ((await data(await send(RR(bid, tid), "GET"))).rules as Json[]).map((r) => r.id),
    ).toEqual([rule.id]);
    const patched = await send(`${RR(bid, tid)}/${rule.id}`, "PATCH", { kind: "is" });
    expect(patched.status).toBe(200);
    expect(((await data(patched)).rule as Json).kind).toBe("is");
    const del = await send(`${RR(bid, tid)}/${rule.id}`, "DELETE");
    expect(del.status).toBe(200);
    expect(await liveRules(bid)).toEqual([]);
  });

  it("refuses a transfer payee of no account of the plan (404) and keeps the other payees' refusals", async () => {
    const bid = await plan();
    const other = await plan();
    const foreign = await account(other, "checking", 0, "ZZ-TEST Elsewhere");
    for (const id of ["transfer:nope", transferPayeeId(foreign.id)]) {
      const res = await send(RR(bid, id), "POST", { kind: "is", text: "x" });
      expect(res.status).toBe(404);
    }
    expect(await liveRules(bid)).toEqual([]);
  });

  it("the transfer payee itself stays read-only: rename and delete are still 403", async () => {
    const bid = await plan();
    const acct = await account(bid, "checking", 0, "ZZ-TEST Card");
    const tid = transferPayeeId(acct.id);
    const r = await send(`${P(bid)}/${tid}`, "PATCH", { name: "ZZ Other" });
    expect(r.status).toBe(403);
    expect((((await r.json()) as Json).error as Json).detail).toBe(PAYEE_ERRORS.transfer);
    expect((await send(`${P(bid)}/${tid}`, "DELETE")).status).toBe(403);
  });
});

describe("the import and a rule on a transfer payee (EXF-885)", () => {
  beforeEach(setupPlaid);

  it("is ignored by the import: the row keeps the bank's name as an ordinary payee, not a transfer", async () => {
    const s = await setup();
    const other = await account(s.plan, "savings", 0, "ZZ-TEST Savings");
    const tid = transferPayeeId(other.id);
    const res = await json(
      RR(s.plan, tid),
      { method: "POST" },
      { kind: "is", text: "ZZ BANK SAVINGS XFER" },
    );
    expect(res.status).toBe(201);
    await s.bank({ added: [txn("ZZ-1", "ZZ BANK SAVINGS XFER")] });
    const r = await s.row("ZZ-1");
    expect(r.payee_name).toBe("ZZ BANK SAVINGS XFER");
    expect(r.payee_id).not.toBe(tid);
    expect(r.transfer_account_id ?? null).toBeNull();
    expect(await s.payeeNames()).toContain("ZZ BANK SAVINGS XFER");
    const [log] = await q(
      "select after_json from change_log where entity_type = 'transaction' and entity_id = ?",
      r.id,
    );
    expect(JSON.parse(log?.after_json).rename_rule_id).toBeUndefined();
    expect(plaidData).toBeDefined();
  });
});
