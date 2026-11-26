import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { actor, api, type Json as CJson, send as csend } from "./category-helpers";
import {
  account,
  body,
  enterDueRest,
  type Json,
  plan,
  q,
  S,
  sched,
  send,
  TODAY,
} from "./scheduled-helpers";

const mk = (a: string, b: string, extra: Json = {}) => ({
  account_id: a,
  transfer_account_id: b,
  date_first: "2026-12-01",
  frequency: "monthly",
  amount: -100000,
  ...extra,
});
const list = async (bid: string, accountId?: string): Promise<Json[]> => {
  const qs = accountId ? `&account_id=${accountId}` : "";
  return (await body(await send(`${S(bid)}?today=${TODAY}${qs}`, "GET"))).scheduled_transactions;
};
const acct = (bid: string, id: string, op: string) =>
  send(`/api/v1/budgets/${bid}/accounts/${id}${op}`, op ? "POST" : "DELETE", op ? {} : undefined);

describe("scheduled transfers: closing an account ends nothing, it hides the pair", () => {
  it.each(["other", "series"])(
    "closing the %s account hides the schedule until reopen",
    async (which) => {
      const b = await plan();
      const a = await account(b, "checking", 0);
      const s = await account(b, "savings", 0);
      const t = (await sched(b, mk(a, s, { date_first: "2026-11-20" }))).scheduled_transaction;
      const closing = which === "other" ? s : a;
      expect((await acct(b, closing, "/close")).status).toBe(200);
      expect(await list(b, a)).toHaveLength(0);
      expect(await list(b, s)).toHaveLength(0);
      expect(await list(b)).toHaveLength(0);
      expect((await send(`${S(b)}/${t.id}`, "GET")).status).toBe(404);
      const bulk = await send(`${S(b)}/bulk?today=${TODAY}`, "POST", {
        op: "enter_now",
        ids: [t.id],
      });
      expect(bulk.status).toBe(422);
      expect(JSON.stringify(await bulk.json())).toContain("account_closed");
      expect((await body(await enterDueRest(b, "2026-11-21"))).entered).toHaveLength(0);
      expect((await acct(b, closing, "/reopen")).status).toBe(200);
      expect(await list(b)).toHaveLength(2);
      expect((await send(`${S(b)}/${t.id}`, "GET")).status).toBe(200);
    },
  );
});

describe("scheduled transfers: deleting an account ends the schedules", () => {
  async function pair() {
    const b = await plan();
    const a = await account(b, "checking", 0);
    const s = await account(b, "savings", 0);
    const t = (await sched(b, mk(a, s))).scheduled_transaction;
    return { b, a, s, t };
  }
  const logs = (id: string) =>
    q(
      "select action, entity_type, change_set_id, before_json, after_json from change_log where entity_id = ? order by rowid",
      id,
    );
  it.each(["other", "series"])(
    "deleting the %s account ends the series, logged in its change set",
    async (which) => {
      const { b, a, s, t } = await pair();
      const victim = which === "other" ? s : a;
      const survivor = which === "other" ? a : s;
      const res = await acct(b, victim, "");
      expect(res.status).toBe(200);
      expect(await list(b, survivor)).toHaveLength(0);
      expect(await list(b)).toHaveLength(0);
      const row = (await q("select deleted_at from scheduled_transactions where id = ?", t.id))[0];
      expect(row.deleted_at).not.toBeNull();
      const del = (await logs(t.id)).find((l) => l.action === "delete");
      expect(del?.entity_type).toBe("scheduled_transaction");
      const acctLog = (await logs(victim)).find((l) => l.action === "delete");
      expect(del?.change_set_id).toBeTruthy();
      expect(del?.change_set_id).toBe(acctLog?.change_set_id);
      expect(JSON.parse(del?.after_json).deleted).toBe(true);
      expect(JSON.parse(del?.before_json).deleted).toBe(false);
      expect(JSON.parse(del?.before_json).transfer_account_id).toBe(s);
    },
  );

  it("a delete that fails (has transactions) leaves the schedules", async () => {
    const { b, s, t } = await pair();
    await send(`/api/v1/budgets/${b}/transactions`, "POST", {
      account_id: s,
      date: "2026-11-10",
      amount: 1000,
      payee_name: "ZZ Pay",
    });
    expect((await acct(b, s, "")).status).toBe(409);
    expect((await send(`${S(b)}/${t.id}`, "GET")).status).toBe(200);
    expect(await list(b)).toHaveLength(2);
  });

  it("a plain schedule on another account is untouched", async () => {
    const { b, a, s } = await pair();
    const plain = (
      await sched(b, {
        account_id: a,
        date_first: "2026-12-01",
        frequency: "monthly",
        amount: -1,
        payee_name: "ZZ P",
      })
    ).scheduled_transaction;
    expect((await acct(b, s, "")).status).toBe(200);
    expect((await send(`${S(b)}/${plain.id}`, "GET")).status).toBe(200);
  });
});

describe("scheduled transfers: deleting a category", () => {
  it("moves an on-plan to tracking transfer schedule and leaves an on-plan one alone", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    const s = await account(b, "savings", 0);
    const t = await account(b, "otherAsset", 0);
    const g = await createCategoryGroup(env, actor, { budget_id: b, name: "Spend" });
    const from = (await createCategory(env, actor, { budget_id: b, group_id: g.id, name: "From" }))
      .id;
    const to = (await createCategory(env, actor, { budget_id: b, group_id: g.id, name: "To" })).id;
    const withCat = (await sched(b, mk(a, t, { category_id: from }))).scheduled_transaction;
    const onOn = (await sched(b, mk(a, s))).scheduled_transaction;
    const before = (
      await q(
        "select id, updated_at, write_token from scheduled_transactions where id = ?",
        onOn.id,
      )
    )[0];
    const res = await csend("DELETE", api(b, `/categories/${from}?reassign_to=${to}`));
    expect(res.status).toBe(200);
    expect(((await res.json()) as CJson).data).toBeDefined();
    const moved = (
      await q("select category_id from scheduled_transactions where id = ?", withCat.id)
    )[0];
    expect(moved.category_id).toBe(to);
    const logged = await q(
      "select 1 from change_log where entity_id = ? and entity_type = 'scheduled_transaction' and action = 'update'",
      withCat.id,
    );
    expect(logged.length).toBeGreaterThan(0);
    const after = (
      await q(
        "select id, updated_at, write_token from scheduled_transactions where id = ?",
        onOn.id,
      )
    )[0];
    expect(after).toEqual(before);
  });
});
