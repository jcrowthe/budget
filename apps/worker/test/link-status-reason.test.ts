import { beforeEach, describe, expect, it } from "vitest";
import { runSync } from "../src/services/plaid-sync";
import { json } from "./helpers";
import { plaidError } from "./plaid-stub";
import {
  A,
  connRow,
  data,
  failingBatchEnv,
  type Json,
  setupPlaid,
  stubBank,
  syncOne,
  world1,
} from "./plaid-sync-helpers";

beforeEach(setupPlaid);

/** Plaid's code → the status it leaves, the stored code, and the reason the reads carry. */
const TABLE: [string, string, string | null][] = [
  ["INSTITUTION_NOT_AVAILABLE", "delayed", "unavailable"],
  ["INSTITUTION_NO_LONGER_SUPPORTED", "delayed", "unsupported"],
  ["INSTITUTION_DOWN", "delayed", null],
  ["INSTITUTION_NOT_RESPONDING", "delayed", null],
  ["INVALID_MFA", "login_required", "reauthorize"],
  ["INSUFFICIENT_CREDENTIALS", "login_required", "reauthorize"],
  ["PENDING_EXPIRATION", "login_required", "reauthorize"],
  ["PENDING_DISCONNECT", "login_required", "reauthorize"],
  ["ITEM_LOGIN_REQUIRED", "login_required", null],
  ["ITEM_NOT_FOUND", "broken", null],
];

const reads = async (plan: string, conn: string, account: string) => {
  const list = (await data(await json(`/api/v1/bank-connections?budget_id=${plan}`)))
    .bank_connections as Json[];
  const acct = (await data(await json(`${A(plan)}/${account}`))).account as Json;
  return {
    status_reason: list.find((c) => c.id === conn)?.status_reason,
    connection_reason: acct.connection_reason,
    connection_status: acct.connection_status,
  };
};

describe("the stored reason of a connection's last failure (EXF-866)", () => {
  for (const [code, status, reason] of TABLE) {
    it(`${code} → ${status}, ${reason ?? "no reason"}`, async () => {
      stubBank({ "/transactions/sync": () => plaidError(400, code) });
      const w = await world1();
      await syncOne(w.plan, w.conn);
      const row = await connRow(w.conn);
      expect(row.status).toBe(status);
      expect(row.sync_error_code).toBe(code);
      expect(await reads(w.plan, w.conn, w.account)).toEqual({
        status_reason: reason,
        connection_reason: reason,
        connection_status: status,
      });
    });
  }

  it("a good sync clears the code and the reason", async () => {
    let fail = true;
    stubBank({
      "/transactions/sync": () =>
        fail
          ? plaidError(400, "INSTITUTION_NOT_AVAILABLE")
          : { body: { added: [], modified: [], removed: [], next_cursor: "c", has_more: false } },
    });
    const w = await world1();
    await syncOne(w.plan, w.conn);
    expect((await connRow(w.conn)).sync_error_code).toBe("INSTITUTION_NOT_AVAILABLE");
    fail = false;
    await syncOne(w.plan, w.conn);
    expect((await connRow(w.conn)).sync_error_code).toBeNull();
    expect((await reads(w.plan, w.conn, w.account)).connection_reason).toBeNull();
  });

  it("a failure in Budget (not at the bank) leaves no code", async () => {
    stubBank({ "/transactions/sync": () => plaidError(400, "INSTITUTION_NOT_AVAILABLE") });
    const w = await world1();
    await syncOne(w.plan, w.conn);
    expect((await connRow(w.conn)).sync_error_code).toBe("INSTITUTION_NOT_AVAILABLE");
    stubBank();
    await expect(runSync(failingBatchEnv(1), w.conn)).rejects.toThrow("simulated");
    const row = await connRow(w.conn);
    expect(row.status).toBe("delayed");
    expect(row.sync_error_code).toBeNull();
  });

  it("a code that is not an identifier is not stored", async () => {
    stubBank({ "/transactions/sync": () => plaidError(400, "some message with spaces") });
    const w = await world1();
    await syncOne(w.plan, w.conn);
    expect((await connRow(w.conn)).sync_error_code).toBeNull();
  });
});
