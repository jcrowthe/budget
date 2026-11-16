import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { createCategoryGroup } from "../src/services/categories";
import { json } from "./helpers";

// EXF-532 (Lead's note 1): the migration's backfill for plans that already have credit accounts.
// biome-ignore lint/suspicious/noExplicitAny: raw rows in tests
type Json = any;
const actor = "user:tester@localhost";

// The migration's own INSERT statements, run on rows arranged to look as they did before it.
const inserts = () => {
  const files = env.TEST_MIGRATIONS as unknown as { name: string; queries: string[] }[];
  const m = files.find((f) => f.name.includes("credit_payment_categories"));
  expect(m).toBeDefined();
  return (m?.queries ?? []).map((q) => q.trim()).filter((q) => /^INSERT/.test(q));
};
const rows = async (sql: string, ...b: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...b)
      .all<Json>()
  ).results;
const account = async (bid: string, name: string, type: string, balance = 0) => {
  const res = await json(
    `/api/v1/budgets/${bid}/accounts`,
    { method: "POST" },
    { name, type, balance, date: "2026-11-01" },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.account.id as string;
};
const newPlan = async () =>
  (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;

describe("credit payment categories migration backfill", () => {
  it("gives each live credit account of a plan its category, once, and leaves other plans alone", async () => {
    const p1 = await newPlan();
    const p2 = await newPlan();
    // A group the owner made by hand with the system group's name stays an ordinary group.
    const hand = await createCategoryGroup(env, actor, {
      budget_id: p1,
      name: "Credit Card Payments",
    });
    const visa = await account(p1, "ZZ Visa", "creditCard", 5000);
    const loc = await account(p1, "ZZ LOC", "lineOfCredit");
    const gone = await account(p1, "ZZ Gone", "creditCard");
    await account(p1, "ZZ Checking", "checking", 1000);
    await account(p2, "ZZ Checking", "checking", 1000);
    const del = await json(`/api/v1/budgets/${p1}/accounts/${gone}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    // "Before": the plan as it was when the migration ran: no row with a kind, no payment category.
    await env.DB.prepare("delete from categories where budget_id = ? and kind is not null")
      .bind(p1)
      .run();
    await env.DB.prepare("delete from category_groups where budget_id = ? and kind is not null")
      .bind(p1)
      .run();
    const p1Before = await rows(
      "select id, name, kind from category_groups where budget_id = ?",
      p1,
    );
    expect(p1Before.filter((g) => g.kind !== null)).toHaveLength(0);
    const p2Before = await rows("select * from category_groups where budget_id = ?", p2);
    const p2Cats = await rows("select * from categories where budget_id = ?", p2);

    const queries = inserts();
    expect(queries).toHaveLength(2);
    const snapshot = async () => ({
      groups: await rows(
        "select id, name, kind, sort_order from category_groups where budget_id = ? order by id",
        p1,
      ),
      cats: await rows(
        "select id, name, kind, account_id, group_id, sort_order, hidden from categories where budget_id = ? order by id",
        p1,
      ),
    });
    for (const q of queries) await env.DB.prepare(q).run();
    const once = await snapshot();

    const systemGroups = once.groups.filter((g) => g.kind === "credit_card_payments");
    expect(systemGroups).toHaveLength(1);
    expect(systemGroups[0]?.name).toBe("Credit Card Payments");
    const payments = once.cats.filter((c) => c.kind === "credit_card_payment");
    expect(payments.map((c) => c.name).sort()).toEqual(["ZZ LOC", "ZZ Visa"]);
    expect(payments.map((c) => c.account_id).sort()).toEqual([loc, visa].sort());
    expect(payments.every((c) => c.group_id === systemGroups[0]?.id)).toBe(true);
    expect(payments.every((c) => UUID.test(c.id))).toBe(true);
    expect(UUID.test(systemGroups[0]?.id)).toBe(true);
    // The hand-made group is still an ordinary group, and the deleted card got nothing.
    expect(once.groups.find((g) => g.id === hand.id)?.kind).toBeNull();
    expect(payments.some((c) => c.account_id === gone)).toBe(false);
    // The system group sorts before every other group.
    const others = once.groups.filter((g) => g.kind === null).map((g) => g.sort_order);
    expect(systemGroups[0]?.sort_order).toBeLessThan(Math.min(...others));
    // No history rows are written by the backfill.
    expect(
      (
        await rows(
          "select count(*) as n from change_log where budget_id = ? and entity_id = ?",
          p1,
          payments[0]?.id,
        )
      )[0]?.n,
    ).toBe(0);

    // Plan 2 (no credit account) is unchanged.
    expect(await rows("select * from category_groups where budget_id = ?", p2)).toEqual(p2Before);
    expect(await rows("select * from categories where budget_id = ?", p2)).toEqual(p2Cats);

    // A second run changes nothing.
    for (const q of queries) await env.DB.prepare(q).run();
    expect(await snapshot()).toEqual(once);

    // The plan reads normally and shows the group first.
    const res = await json(`/api/v1/budgets/${p1}/months/2026-11-01`);
    const m = ((await res.json()) as Json).data;
    expect(m.groups[0]).toMatchObject({
      name: "Credit Card Payments",
      kind: "credit_card_payments",
    });
    expect(m.groups[0].categories.map((c: Json) => c.name)).toEqual(["ZZ Visa", "ZZ LOC"]);
  });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
