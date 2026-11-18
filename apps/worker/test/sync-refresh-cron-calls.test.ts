import { beforeEach, describe, expect, it } from "vitest";
import { cronRun } from "../src/scheduled";
import type { requestSync } from "../src/services/plaid-sync";
import { countingEnv, q, setupPlaid, stubBank } from "./plaid-sync-helpers";

beforeEach(setupPlaid);

/** D1 and Plaid calls of one scheduled run (EXF-751): no schedule exists in this file, so the scheduler finds nothing. */
describe("the scheduled run: calls", () => {
  const counted = () => {
    const c = countingEnv();
    let runs = 0;
    const run = (async () => {
      runs++;
      return { has_more: false };
    }) as unknown as typeof requestSync;
    return { c, run, runs: () => runs };
  };

  it("nothing due: 3 D1, no run", async () => {
    const calls = stubBank();
    await q("update bank_connections set status = 'broken'");
    const { c, run, runs } = counted();
    calls.length = 0;
    await cronRun(c.env, new Date(), run);
    expect({ d1: c.calls.d1, runs: runs() }).toEqual({ d1: 3, runs: 0 });
    expect(calls).toHaveLength(0);
  });

  it("five due: 3 D1 of its own and 5 runs, no Plaid call of its own", async () => {
    const calls = stubBank();
    await q("update bank_connections set status = 'broken'");
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      await q(
        "insert into bank_connections (id, display_id, environment, plaid_item_id, institution_id, institution_name, nickname, status, provider, created_at, updated_at) values (?, ?, 'sandbox', ?, 'ins_1', 'ZZ Bank', 'ZZ Bank', 'connected', 'Plaid', ?, ?)",
        crypto.randomUUID(),
        crypto.randomUUID().slice(0, 6),
        crypto.randomUUID(),
        now,
        now,
      );
    }
    const { c, run, runs } = counted();
    calls.length = 0;
    await cronRun(c.env, new Date(), run);
    expect({ d1: c.calls.d1, runs: runs() }).toEqual({ d1: 3, runs: 5 });
    expect(calls).toHaveLength(0);
  });
});
