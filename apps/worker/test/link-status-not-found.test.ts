import { beforeEach, describe, expect, it } from "vitest";
import { json } from "./helpers";
import { plaidError } from "./plaid-stub";
import {
  A,
  connRow,
  count,
  data,
  type Json,
  linked,
  planCalls,
  q,
  setupPlaid,
  stubBank,
  syncOne,
  world,
} from "./plaid-sync-helpers";

/** The bank's present list of accounts; a sync lists only these. */
const ALL = ["acc-chk", "acc-sav", "acc-ira"];
let present = ALL;
let refuse = false;
const listing = () => ({
  body: {
    item: { institution_id: "ins_109508" },
    accounts: [
      ["acc-chk", "ZZ Checking", "checking"],
      ["acc-sav", "ZZ Savings", "savings"],
      ["acc-ira", "ZZ Retirement", "checking"],
    ]
      .filter(([id]) => present.includes(id as string))
      .map(([account_id, name, subtype]) => ({
        account_id,
        name,
        mask: "0000",
        type: "depository",
        subtype,
        balances: { current: 10, available: null },
      })),
  },
});

beforeEach(async () => {
  present = ALL;
  refuse = false;
  await setupPlaid();
});

async function two() {
  const calls = stubBank({
    "/accounts/get": () => (refuse ? plaidError(500, "INTERNAL_SERVER_ERROR") : listing()),
  });
  const w = await world();
  const chk = await linked(w.plan, w.bank["ZZ Checking"] as string);
  const sav = await linked(w.plan, w.bank["ZZ Savings"] as string);
  const read = async (id: string) => (await data(await json(`${A(w.plan)}/${id}`))).account as Json;
  return { ...w, calls, chk, sav, read };
}

describe("Account Not Found (EXF-866)", () => {
  it("marks the linked account whose bank account is not listed, and clears it when it is back", async () => {
    const t = await two();
    present = ["acc-chk", "acc-ira"];
    await syncOne(t.plan, t.conn);
    const sav = await t.read(t.sav);
    expect(typeof sav.link_missing_since).toBe("string");
    expect(new Date(sav.link_missing_since as string).toISOString()).toBe(sav.link_missing_since);
    expect((await t.read(t.chk)).link_missing_since).toBeNull();
    expect(sav.connection_status).toBe("connected");
    expect((await t.read(t.chk)).connection_status).toBe("connected");
    expect((await connRow(t.conn)).status).toBe("connected");
    // the mark is kept, with its first time, by a second sync without it
    await new Promise((r) => setTimeout(r, 5));
    await syncOne(t.plan, t.conn);
    expect((await t.read(t.sav)).link_missing_since).toBe(sav.link_missing_since);
    present = ALL;
    await syncOne(t.plan, t.conn);
    expect((await t.read(t.sav)).link_missing_since).toBeNull();
  });

  it("marks nothing for a failed answer, or for a connection that needs a sign-in", async () => {
    const t = await two();
    present = ["acc-chk"];
    refuse = true;
    await syncOne(t.plan, t.conn);
    expect((await t.read(t.sav)).link_missing_since).toBeNull();
    refuse = false;
    await q("update bank_connections set status = 'login_required' where id = ?", t.conn);
    const before = t.calls.length;
    await syncOne(t.plan, t.conn);
    expect(t.calls.length).toBe(before);
    expect(planCalls(t.calls.slice(before), "/accounts/get")).toHaveLength(0);
    expect((await t.read(t.sav)).link_missing_since).toBeNull();
  });

  it("unlinking clears it", async () => {
    const t = await two();
    present = ["acc-chk"];
    await syncOne(t.plan, t.conn);
    expect((await t.read(t.sav)).link_missing_since).not.toBeNull();
    const res = await json(`${A(t.plan)}/${t.sav}/link`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await t.read(t.sav)).link_missing_since).toBeNull();
  });

  it("a marked account may be linked to another bank account; a healthy link is refused", async () => {
    const t = await two();
    present = ["acc-chk", "acc-ira"];
    await syncOne(t.plan, t.conn);
    expect((await t.read(t.sav)).link_missing_since).not.toBeNull();
    const logs = () => count("select count(*) n from change_log where entity_type = 'account'");
    const healthy = await json(
      `${A(t.plan)}/${t.chk}/link`,
      { method: "POST" },
      { bank_account_id: t.bank["ZZ Retirement"] },
    );
    expect(healthy.status).toBe(409);
    expect(((await healthy.json()) as Json).error.name).toBe("account_already_linked");
    const before = await logs();
    const res = await json(
      `${A(t.plan)}/${t.sav}/link`,
      { method: "POST" },
      { bank_account_id: t.bank["ZZ Retirement"] },
    );
    expect(res.status).toBe(200);
    const sav = await t.read(t.sav);
    expect(sav.link_missing_since).toBeNull();
    expect(sav.bank_account_id).toBe(t.bank["ZZ Retirement"]);
    expect(await logs()).toBe(before + 1);
  });

  it("a relink to a bank account of another connection carries that connection's reason", async () => {
    const t = await two();
    // a second connection of the plan, delayed with no code; the first is delayed as the bank is unavailable
    const made = await json(
      "/api/v1/bank-connections",
      { method: "POST" },
      { budget_id: t.plan, public_token: "public-sandbox-token", institution_id: "ins_109508" },
    );
    expect(made.status).toBe(201);
    const other = ((await data(made)).bank_connection as Json).accounts as Json[];
    const target = other.find((a) => a.name === "ZZ Retirement") as Json;
    present = ["acc-chk"];
    await syncOne(t.plan, t.conn);
    await q(
      "update bank_connections set status = 'delayed', sync_error_code = 'INSTITUTION_NOT_AVAILABLE' where id = ?",
      t.conn,
    );
    await q("update bank_connections set status = 'delayed' where id <> ?", t.conn);
    const res = await json(
      `${A(t.plan)}/${t.sav}/link`,
      { method: "POST" },
      { bank_account_id: target.id },
    );
    expect(res.status).toBe(200);
    const posted = ((await data(res)).account as Json).connection_reason;
    expect(posted).toBeNull();
    expect((await t.read(t.sav)).connection_reason).toBe(posted);
  });
});
