import { env } from "cloudflare:test";
import { json } from "./helpers";
import { createPlan, seedSandboxCredentials } from "./plaid-stub";

export interface SeededEnv {
  plan: string;
  connections: { id: string; bankAccountIds: string[] }[];
}

/** A new plan of `environment` and `n` connections of `m` bank accounts each, inserted with SQL (columns named). */
export async function seedConnections(
  environment: "sandbox" | "production",
  n: number,
  m: number,
  opts: { at?: (c: number) => string } = {},
): Promise<SeededEnv> {
  await seedSandboxCredentials();
  const plan = await createPlan(environment);
  const at = opts.at ?? ((c: number) => `2026-11-01T00:${String(c).padStart(2, "0")}:00.000Z`);
  const stmts: D1PreparedStatement[] = [];
  const connections: SeededEnv["connections"] = [];
  for (let c = 0; c < n; c++) {
    const id = crypto.randomUUID();
    const ts = at(c);
    stmts.push(
      env.DB.prepare(
        "insert into bank_connections (id, display_id, environment, plaid_item_id, institution_id, institution_name, nickname, status, provider, created_at, updated_at) values (?, ?, ?, ?, 'ins_1', 'ZZ Bank', 'ZZ Bank', 'connected', 'Plaid', ?, ?)",
      ).bind(id, crypto.randomUUID().slice(0, 6), environment, crypto.randomUUID(), ts, ts),
    );
    const bankAccountIds: string[] = [];
    for (let a = 0; a < m; a++) {
      const bid = crypto.randomUUID();
      bankAccountIds.push(bid);
      stmts.push(
        env.DB.prepare(
          "insert into bank_accounts (id, bank_connection_id, plaid_account_id, name, mask, type, subtype, current_balance, available_balance, balance_updated_at, created_at) values (?, ?, ?, ?, '0000', 'depository', 'checking', 1000, 1000, ?, ?)",
        ).bind(bid, id, crypto.randomUUID(), `ZZ ${c}-${a}`, ts, ts),
      );
    }
    connections.push({ id, bankAccountIds });
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return { plan, connections };
}

/** Links a new plan account to `bankAccountId` through POST /budgets/{plan}/accounts/from-bank; returns its id. */
export async function linkAccount(plan: string, bankAccountId: string): Promise<string> {
  const res = await json(
    `/api/v1/budgets/${plan}/accounts/from-bank`,
    { method: "POST" },
    { bank_account_ids: [bankAccountId], today: "2026-11-10" },
  );
  if (res.status !== 201) throw new Error(`from-bank answered ${res.status}`);
  const body = (await res.json()) as { data: { created: { account: { id: string } }[] } };
  const id = body.data.created[0]?.account.id;
  if (!id) throw new Error("no account id in the from-bank answer");
  return id;
}
