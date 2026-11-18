import { describe, expect, it } from "vitest";
import { linkAccount, seedConnections } from "./connection-list-helpers";
import { json } from "./helpers";

describe("EXF-881: reads that once bound a parameter per row", () => {
  it("lists 101 connections with no bank account", async () => {
    const s = await seedConnections("sandbox", 101, 0);
    const res = await json(`/api/v1/bank-connections?budget_id=${s.plan}`);
    expect(res.status).toBe(200);
    const all = ((await res.json()) as { data: { bank_connections: { id: string }[] } }).data
      .bank_connections;
    expect(all.filter((c) => s.connections.some((x) => x.id === c.id))).toHaveLength(101);
  });

  it("gets one connection of 120 bank accounts with its link", async () => {
    const s = await seedConnections("production", 1, 120);
    const conn = s.connections[0];
    const target = conn?.bankAccountIds[100];
    if (!conn || !target) throw new Error("no seed");
    const linked = await linkAccount(s.plan, target);
    const res = await json(`/api/v1/bank-connections/${conn.id}?budget_id=${s.plan}`);
    expect(res.status).toBe(200);
    const got = (
      (await res.json()) as {
        data: { bank_connection: { accounts: { id: string; linked_account_id: string | null }[] } };
      }
    ).data.bank_connection;
    expect(got.accounts).toHaveLength(120);
    expect(got.accounts.find((a) => a.id === target)?.linked_account_id).toBe(linked);
  });
});
