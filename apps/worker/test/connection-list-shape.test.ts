import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { linkAccount, seedConnections } from "./connection-list-helpers";
import { json } from "./helpers";

describe("EXF-881: the list's answer keeps its shape", () => {
  it("answers field for field, in list order, and the same object from get", async () => {
    const s = await seedConnections("sandbox", 2, 2);
    const [older, newer] = s.connections;
    if (!older || !newer) throw new Error("no seed");
    const ts = (c: number) => `2026-11-01T00:0${c}:00.000Z`;
    const names = [
      ["Alpha", "Bravo"],
      ["Charlie", "Delta"],
    ];
    for (const [ci, c] of [older, newer].entries())
      for (const [ai, id] of c.bankAccountIds.entries())
        await env.DB.prepare(
          "update bank_accounts set name = ?, mask = ?, current_balance = 12340, available_balance = null, balance_updated_at = '2026-11-02T00:00:00.000Z' where id = ?",
        )
          .bind(names[ci]?.[ai], `00${ci}${ai}`, id)
          .run();
    const linked = await linkAccount(s.plan, older.bankAccountIds[1] as string);
    const account = (c: { id: string; bankAccountIds: string[] }, ci: number, ai: number) => ({
      id: c.bankAccountIds[ai],
      bank_connection_id: c.id,
      name: names[ci]?.[ai],
      mask: `00${ci}${ai}`,
      type: "depository",
      subtype: "checking",
      current_balance: 12340,
      available_balance: null,
      balance_updated_at: "2026-11-02T00:00:00.000Z",
      linked_account_id: ci === 0 && ai === 1 ? linked : null,
    });
    const conn = (c: { id: string; bankAccountIds: string[] }, ci: number) => ({
      id: c.id,
      display_id: expect.any(String),
      environment: "sandbox",
      institution_id: "ins_1",
      institution_name: "ZZ Bank",
      institution_logo: null,
      nickname: "ZZ Bank",
      status: "connected",
      status_reason: null,
      provider: "Plaid",
      last_synced_at: null,
      last_reset_at: null,
      sync_failed_at: null,
      created_at: ts(ci),
      accounts: [account(c, ci, 0), account(c, ci, 1)],
    });
    const res = await json(`/api/v1/bank-connections?budget_id=${s.plan}`);
    const all = ((await res.json()) as { data: { bank_connections: { id: string }[] } }).data
      .bank_connections;
    const mine = all.filter((c) => c.id === older.id || c.id === newer.id);
    expect(mine).toEqual([conn(newer, 1), conn(older, 0)]);
    const got = await json(`/api/v1/bank-connections/${older.id}?budget_id=${s.plan}`);
    const one = ((await got.json()) as { data: { bank_connection: unknown } }).data;
    expect(JSON.stringify(one)).toContain(older.id);
    expect(mine[1]).toEqual(
      (one as { bank_connection?: unknown }).bank_connection ?? (one as unknown),
    );
  });
});
