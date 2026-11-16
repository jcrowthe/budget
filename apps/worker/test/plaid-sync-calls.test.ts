import { beforeEach, describe, expect, it } from "vitest";
import {
  budgetWorld,
  count,
  countingEnv,
  imports,
  planCalls,
  setupPlaid,
  stubBank,
  world1,
} from "./plaid-sync-helpers";

beforeEach(setupPlaid);

describe("sync call budget (EXF-613)", () => {
  it("EXF-613 2: every run of that import stays within 45 calls", async () => {
    const calls = stubBank();
    const { conn, account } = await budgetWorld();
    const c = countingEnv();
    const per: { d1: number; plaid: number }[] = [];
    const { runSync } = await import("../src/services/plaid-sync");
    for (let i = 0; i < 8; i++) {
      c.reset();
      const before = calls.length;
      const r = await runSync(c.env, conn);
      per.push({ d1: c.calls.d1, plaid: calls.length - before });
      if (!r.has_more) break;
    }
    console.log("EXF-613 calls per run", JSON.stringify(per));
    for (const p of per) expect(p.d1 + p.plaid).toBeLessThanOrEqual(45);
    expect(await imports(account)).toHaveLength(490);
    expect(
      await count(
        "select count(*) n from transactions where import_id is not null and deleted_at is null",
      ),
    ).toBe(500);
  }, 60_000);
});
