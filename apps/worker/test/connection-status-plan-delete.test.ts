import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import * as accountsRepo from "../src/repositories/accounts";
import * as budgetsRepo from "../src/repositories/budgets";
import { createAccountsFromBank } from "../src/services/account-links";
import { actor } from "./bulk-helpers";
import { json } from "./helpers";
import { createPlan, SENTINEL, seedSandboxCredentials, stubPlaid } from "./plaid-stub";

interface Row {
  [k: string]: unknown;
}

async function rows(sql: string, ...args: unknown[]): Promise<Row[]> {
  return (
    (await env.DB.prepare(sql)
      .bind(...args)
      .all()) as { results: Row[] }
  ).results;
}

describe("EXF-824: a deleted plan leaves no bank link behind", () => {
  beforeEach(async () => {
    await seedSandboxCredentials();
    stubPlaid({
      "/item/public_token/exchange": () => ({
        body: { access_token: SENTINEL.accessToken, item_id: `item-del-${crypto.randomUUID()}` },
      }),
      "/accounts/get": () => ({
        body: {
          item: { institution_id: "ins_109508" },
          accounts: ["a", "b", "c"].map((x) => ({
            account_id: `acc-${x}-${crypto.randomUUID()}`,
            name: `ZZ ${x}`,
            mask: "0000",
            type: "depository",
            subtype: "checking",
            balances: { current: 10, available: null },
          })),
        },
      }),
      "/institutions/get_by_id": () => ({
        body: { institution: { institution_id: "ins_109508", name: "ZZ Test Bank", logo: null } },
      }),
      "/item/remove": () => ({ body: { removed: true } }),
    });
  });

  async function connect(plan: string) {
    const res = await json(
      "/api/v1/bank-connections",
      { method: "POST" },
      { budget_id: plan, public_token: SENTINEL.publicToken, institution_id: "ins_109508" },
    );
    const d = ((await res.json()) as any).data;
    const c = d.bank_connection ?? d;
    return { id: c.id as string, bankIds: (c.accounts as { id: string }[]).map((a) => a.id) };
  }

  async function deletePlan(plan: string) {
    const res = await json(`/api/v1/budgets/${plan}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  }

  async function removeConnection(id: string, livePlan: string) {
    return json(`/api/v1/bank-connections/${id}?budget_id=${livePlan}`, { method: "DELETE" });
  }

  async function planDeletedAt(plan: string): Promise<string> {
    const r = await rows(
      "select created_at from change_log where budget_id = ? and entity_type='budget' and action='delete'",
      plan,
    );
    return r[0]?.created_at as string;
  }

  it("a deleted plan leaves no link: removing the connection writes nothing to it", async () => {
    const plan = await createPlan("sandbox");
    const live = await createPlan("sandbox");
    const { id, bankIds } = await connect(plan);
    await createAccountsFromBank(env, actor, plan, { bank_account_ids: [bankIds[0] as string] });
    await deletePlan(plan);
    const at = await planDeletedAt(plan);
    expect((await removeConnection(id, live)).status).toBe(200);
    const later = await rows(
      "select count(*) as n from change_log where budget_id = ? and created_at > ?",
      plan,
      at,
    );
    expect(later[0]?.n).toBe(0);
  });

  it("the delete unlinks every linked account with its history row, in the delete's batch", async () => {
    const plan = await createPlan("sandbox");
    const { bankIds } = await connect(plan);
    await createAccountsFromBank(env, actor, plan, {
      bank_account_ids: [bankIds[0] as string, bankIds[1] as string],
    });
    await json(
      `/api/v1/budgets/${plan}/accounts`,
      { method: "POST" },
      { name: "ZZ Plain", type: "checking", balance: 0 },
    );
    await deletePlan(plan);
    const at = await planDeletedAt(plan);
    const linked = await rows(
      "select bank_account_id, import_start_date from accounts where budget_id = ? and name like 'ZZ %'",
      plan,
    );
    for (const r of linked) {
      expect(r.bank_account_id).toBeNull();
      expect(r.import_start_date).toBeNull();
    }
    const logs = await rows(
      "select created_at, after_json from change_log where budget_id = ? and entity_type='account' and action='update'",
      plan,
    );
    const unlinked = logs.filter((l) => JSON.parse(l.after_json as string).linked === false);
    expect(unlinked.length).toBe(2);
    for (const l of unlinked) expect((l.created_at as string) <= at).toBe(true);
  });

  it("a link made after the read loses the whole delete", async () => {
    const plan = await createPlan("sandbox");
    const { bankIds } = await connect(plan);
    const db = getDb(env);
    const before = (await budgetsRepo.findActive(db, plan)) as budgetsRepo.BudgetRow;
    // The delete read no links; then an account is linked before its batch runs.
    const guard = accountsRepo.linksAsRead(plan, []);
    await createAccountsFromBank(env, actor, plan, { bank_account_ids: [bankIds[0] as string] });
    const result = await budgetsRepo
      .softDeleteStmt(db, before, new Date().toISOString(), guard)
      .run();
    expect((result as any).meta.changes).toBe(0);
    expect(await budgetsRepo.findActive(db, plan)).toBeTruthy();
    const linked = await rows(
      "select count(*) as n from accounts where budget_id = ? and bank_account_id is not null",
      plan,
    );
    expect(linked[0]?.n).toBe(1);
  });

  it("leftover links in a plan deleted before this change: removal unlinks them with no history row", async () => {
    const plan = await createPlan("sandbox");
    const live = await createPlan("sandbox");
    const { id, bankIds } = await connect(plan);
    await createAccountsFromBank(env, actor, plan, { bank_account_ids: [bankIds[0] as string] });
    await env.DB.prepare("update budgets set deleted_at = ? where id = ?")
      .bind("2030-01-01T00:00:00.000Z", plan)
      .run();
    const before = (await rows("select count(*) as n from change_log where budget_id = ?", plan))[0]
      ?.n;
    expect((await removeConnection(id, live)).status).toBe(200);
    const after = await rows(
      "select bank_account_id from accounts where budget_id = ? and bank_account_id is not null",
      plan,
    );
    expect(after.length).toBe(0);
    expect(
      (await rows("select count(*) as n from change_log where budget_id = ?", plan))[0]?.n,
    ).toBe(before);
  });
});
