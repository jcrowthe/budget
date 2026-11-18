import { describe, expect, it } from "vitest";
import { listBankConnections } from "../src/services/bank-connections";
import { linkAccount, seedConnections } from "./connection-list-helpers";
import { createPlan } from "./plaid-stub";
import { countingEnv } from "./plaid-sync-helpers";

describe("EXF-881: D1 calls of the bank connections list", () => {
  // Measured on f9f1281: 4 with connections (the 140 case failed on its 4th), 2 empty.
  it("takes 4 calls for 10 connections of 14 bank accounts", async () => {
    const s = await seedConnections("sandbox", 10, 14);
    await linkAccount(s.plan, s.connections[9]?.bankAccountIds[0] as string);
    const c = countingEnv();
    c.reset();
    const list = await listBankConnections(c.env, s.plan);
    expect(c.calls.d1).toBe(4);
    expect(list.filter((x) => s.connections.some((y) => y.id === x.id))).toHaveLength(10);
  });

  it("takes 2 calls when the environment holds no connection", async () => {
    const plan = await createPlan("production");
    const c = countingEnv();
    c.reset();
    expect(await listBankConnections(c.env, plan)).toEqual([]);
    expect(c.calls.d1).toBe(2);
  });
});
