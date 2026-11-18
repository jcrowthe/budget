import { describe, expect, it } from "vitest";
import { linkAccount, seedConnections } from "./connection-list-helpers";
import { json } from "./helpers";

interface Listed {
  id: string;
  accounts: { id: string; linked_account_id: string | null }[];
}

describe("EXF-881: the list with 140 bank accounts in one environment", () => {
  it("answers 200 with every connection and account, and shows the link on the tenth", async () => {
    const s = await seedConnections("sandbox", 10, 14);
    const tenth = s.connections[9];
    const target = tenth?.bankAccountIds[3];
    if (!target) throw new Error("no seed");
    const linked = await linkAccount(s.plan, target);
    const res = await json(`/api/v1/bank-connections?budget_id=${s.plan}`);
    expect(res.status).toBe(200);
    const all = ((await res.json()) as { data: { bank_connections: Listed[] } }).data
      .bank_connections;
    const mine = all.filter((c) => s.connections.some((x) => x.id === c.id));
    expect(mine).toHaveLength(10);
    for (const c of s.connections) {
      const got = mine.find((m) => m.id === c.id);
      expect(got?.accounts.map((a) => a.id).sort()).toEqual([...c.bankAccountIds].sort());
    }
    const accts = mine.flatMap((c) => c.accounts);
    expect(accts).toHaveLength(140);
    for (const a of accts) expect(a.linked_account_id).toBe(a.id === target ? linked : null);
  });
});
