import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";

// biome-ignore lint/suspicious/noExplicitAny: raw rows in tests
type Json = any;

// The migration's own INSERT and UPDATE statements, rerun on rows written with payee_id NULL.
const migration = () => {
  const files = env.TEST_MIGRATIONS as unknown as { name: string; queries: string[] }[];
  const m = files.find((f) => f.name.includes("payees"));
  expect(m).toBeDefined();
  return (m?.queries ?? []).map((q) => q.trim()).filter((q) => /^(INSERT|UPDATE)/.test(q));
};

async function plan() {
  const id = (
    await createBudget(env, "user:tester@localhost", { name: `ZZ-TEST ${crypto.randomUUID()}` })
  ).id;
  const res = await json(
    `/api/v1/budgets/${id}/accounts`,
    { method: "POST" },
    { name: "ZZ A", type: "checking", balance: 0, date: "2026-11-01" },
  );
  const account = ((await res.json()) as Json).data.account.id as string;
  // Make the rows look as they did before the migration: no payee_id on the Starting Balance either.
  await env.DB.prepare("update transactions set payee_id = null where budget_id = ?")
    .bind(id)
    .run();
  await env.DB.prepare("delete from payees where budget_id = ?").bind(id).run();
  return { id, account };
}

async function tx(p: { id: string; account: string }, payee: string | null, deleted = false) {
  const budget = p.id;
  await env.DB.prepare(
    "insert into transactions (id, budget_id, account_id, date, payee_name, amount, cleared, approved, created_at, updated_at, deleted_at, inflow_to_ready_to_assign) values (?, ?, ?, '2026-11-01', ?, 0, 'cleared', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', ?, 0)",
  )
    .bind(crypto.randomUUID(), budget, p.account, payee, deleted ? "2026-11-02" : null)
    .run();
}
const rows = async (sql: string, ...b: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...b)
      .all<Json>()
  ).results;

describe("payees migration backfill", () => {
  it("makes one payee per distinct name per plan and is idempotent", async () => {
    const pa = await plan();
    const pb = await plan();
    const a = pa.id;
    const b = pb.id;
    await tx(pa, "ZZ Shop");
    await tx(pa, "ZZ Shop");
    await tx(pa, "zz shop");
    await tx(pa, "Starting Balance");
    await tx(pa, "Starting Balance");
    await tx(pa, "ZZ Gone", true);
    await tx(pa, "");
    await tx(pa, null);
    await tx(pb, "ZZ Shop");
    await tx(pb, "Starting Balance");
    const queries = migration();
    expect(queries).toHaveLength(3);
    const run = async () => {
      for (const q of queries) await env.DB.prepare(q).run();
    };
    await run();
    const snapshot = async () =>
      rows("select id, budget_id, name, system from payees where budget_id in (?, ?)", a, b);
    const first = await snapshot();
    expect(
      first
        .filter((p) => p.budget_id === a)
        .map((p) => p.name)
        .sort(),
    ).toEqual(["Starting Balance", "ZZ Gone", "ZZ Shop", "zz shop"]);
    expect(first.filter((p) => p.system === "starting_balance")).toHaveLength(2);
    expect(new Set(first.map((p) => p.id)).size).toBe(first.length);
    expect(
      first.every((p) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.id),
      ),
    ).toBe(true);
    const linked = await rows(
      "select t.payee_name, p.name pname, p.system, p.budget_id pb, t.budget_id tb from transactions t left join payees p on p.id = t.payee_id where t.budget_id in (?, ?)",
      a,
      b,
    );
    for (const r of linked) {
      if (r.payee_name === null || r.payee_name === "") expect(r.pname).toBeNull();
      else {
        expect(r.pname).toBe(r.payee_name);
        expect(r.pb).toBe(r.tb);
        expect(r.system).toBe(r.payee_name === "Starting Balance" ? "starting_balance" : null);
      }
    }
    await run();
    expect(await snapshot()).toEqual(first);
  });
});
