import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cronRun } from "../src/scheduled";
import { tool } from "./account-helpers";
import {
  account,
  body,
  category,
  enter,
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
  memo: "ZZ-TEST move",
  ...extra,
});
const list = async (bid: string, accountId?: string): Promise<Json[]> => {
  const qs = accountId ? `&account_id=${accountId}` : "";
  const res = await send(`${S(bid)}?today=${TODAY}${qs}`, "GET");
  expect(res.status).toBe(200);
  return (await body(res)).scheduled_transactions;
};
const real = (bid: string, accountId: string) =>
  q(
    "select id, date, approved, cleared, amount, payee_name, category_id, transfer_account_id, transfer_transaction_id from transactions where budget_id = ? and account_id = ? and deleted_at is null and payee_name is not 'Starting Balance' order by date, id",
    bid,
    accountId,
  );
const refuse = async (bid: string, input: Json, status = 422) => {
  const res = await send(`${S(bid)}?today=${TODAY}`, "POST", input);
  expect(res.status, JSON.stringify(input)).toBe(status);
  return (await res.json()) as Json;
};
async function two() {
  const b = await plan();
  const a = await account(b);
  const s = await account(b, "savings");
  return { b, a, s };
}

describe("scheduled transfers: create and the mirror", () => {
  it("creates an on-plan transfer; the other account lists a derived mirror", async () => {
    const { b, a, s } = await two();
    const made = await sched(b, mk(a, s));
    const t = made.scheduled_transaction;
    expect(t).toMatchObject({
      account_id: a,
      transfer_account_id: s,
      payee_id: null,
      category_id: null,
      mirror: false,
      amount: -100000,
    });
    expect(t.payee_name).toMatch(/^Transfer : ZZ /);
    const inB = await list(b, s);
    expect(inB).toHaveLength(1);
    expect(inB[0]).toMatchObject({
      id: t.id,
      mirror: true,
      account_id: s,
      transfer_account_id: a,
      amount: 100000,
      memo: "ZZ-TEST move",
      date_next: "2026-12-01",
      frequency: "monthly",
      flag_color: null,
      category_id: null,
    });
    expect(inB[0].payee_name).toBe(`Transfer : ${t.account_name}`);
    const inA = await list(b, a);
    expect(inA).toHaveLength(1);
    expect(inA[0].mirror).toBe(false);
    const all = await list(b);
    expect(all.map((r) => r.mirror).sort()).toEqual([false, true]);
    const got = await send(`${S(b)}/${t.id}`, "GET");
    expect((await body(got)).scheduled_transaction.mirror).toBe(false);
  });

  it("refuses the bad transfers", async () => {
    const { b, a, s } = await two();
    const c = await category(b);
    const t = await account(b, "otherAsset");
    const t2 = await account(b, "otherAsset");
    await refuse(b, mk(a, a));
    await refuse(b, mk(a, "no-such-account"));
    await refuse(b, mk(a, s, { payee_name: "ZZ Payee" }));
    await refuse(b, mk(a, s, { category_id: c }));
    await refuse(b, mk(a, s, { inflow_to_ready_to_assign: true }));
    await refuse(b, mk(t, t2, { category_id: c }));
    const closed = await account(b);
    expect((await send(`/api/v1/budgets/${b}/accounts/${closed}/close`, "POST", {})).status).toBe(
      200,
    );
    const r = await refuse(b, mk(a, closed));
    expect(JSON.stringify(r)).toContain("account_closed");
  });

  it("on-plan to tracking and tracking to on-plan: the category belongs to the on-plan side", async () => {
    const { b, a } = await two();
    const t = await account(b, "otherAsset");
    const c = await category(b);
    const out = (await sched(b, mk(a, t, { category_id: c }))).scheduled_transaction;
    expect(out.category_id).toBe(c);
    expect((await list(b, t))[0]).toMatchObject({ mirror: true, category_id: null });
    const inn = (await sched(b, mk(t, a, { category_id: c, amount: -50000 })))
      .scheduled_transaction;
    expect(inn.category_id).toBe(c);
    const mirrorInA = (await list(b, a)).find((r) => r.id === inn.id);
    expect(mirrorInA).toMatchObject({ mirror: true, category_id: c, amount: 50000 });
    const e = await enter(b, out.id);
    expect(e.status).toBe(201);
    expect((await real(b, a)).some((r) => r.category_id === c)).toBe(true);
    expect((await real(b, t)).every((r) => r.category_id === null)).toBe(true);
  });

  it("PATCH: plain to transfer, re-target, back to plain, and the 422s", async () => {
    const { b, a, s } = await two();
    const s2 = await account(b, "savings");
    const plain = (
      await sched(b, {
        account_id: a,
        date_first: "2026-12-01",
        frequency: "monthly",
        amount: -5000,
        payee_name: "ZZ Payee",
      })
    ).scheduled_transaction;
    const patch = (id: string, input: Json) => send(`${S(b)}/${id}?today=${TODAY}`, "PATCH", input);
    let r = await patch(plain.id, { transfer_account_id: s });
    expect(r.status).toBe(200);
    let t = (await body(r)).scheduled_transaction;
    expect(t).toMatchObject({ transfer_account_id: s, payee_id: null, mirror: false });
    expect((await list(b, s))[0].mirror).toBe(true);
    expect((await patch(plain.id, { payee_name: "ZZ Other" })).status).toBe(422);
    expect((await patch(plain.id, { account_id: s })).status).toBe(422);
    r = await patch(plain.id, { transfer_account_id: s2 });
    t = (await body(r)).scheduled_transaction;
    expect(t.transfer_account_id).toBe(s2);
    expect(await list(b, s)).toHaveLength(0);
    r = await patch(plain.id, { transfer_account_id: null, payee_name: "ZZ Back" });
    expect(r.status).toBe(200);
    t = (await body(r)).scheduled_transaction;
    expect(t).toMatchObject({ transfer_account_id: null, payee_name: "ZZ Back", mirror: false });
    expect(await list(b, s2)).toHaveLength(0);
  });
});

describe("scheduled transfers: enter and delete from either side", () => {
  it.each(["series", "mirror"])("Enter Now from the %s side enters both rows", async (side) => {
    const { b, a, s } = await two();
    const made = (await sched(b, mk(a, s))).scheduled_transaction;
    const listed = (await list(b, side === "series" ? a : s))[0];
    const res = await enter(b, listed.id);
    expect(res.status).toBe(201);
    const out = await body(res);
    expect(out.scheduled_transaction.date_next).toBe("2027-01-01");
    const ra = await real(b, a);
    const rb = await real(b, s);
    expect(ra).toHaveLength(1);
    expect(rb).toHaveLength(1);
    expect(ra[0]).toMatchObject({
      date: TODAY,
      amount: -100000,
      approved: 1,
      cleared: "uncleared",
      transfer_account_id: s,
      transfer_transaction_id: rb[0].id,
    });
    expect(rb[0]).toMatchObject({
      date: TODAY,
      amount: 100000,
      approved: 1,
      transfer_account_id: a,
      transfer_transaction_id: ra[0].id,
    });
    expect(out.transaction.id).toBe(ra[0].id);
    expect((await list(b, a))[0].date_next).toBe("2027-01-01");
    expect((await list(b, s))[0].date_next).toBe("2027-01-01");
    const logs = await q(
      "select entity_type, action from change_log where budget_id = ? and (entity_id = ? or entity_id in (?, ?)) order by rowid",
      b,
      made.id,
      ra[0].id,
      rb[0].id,
    );
    expect(logs.filter((l) => l.entity_type === "transaction")).toHaveLength(2);
  });

  it("a one-off transfer leaves both lists once entered; bulk [id, id] enters once", async () => {
    const { b, a, s } = await two();
    const one = (await sched(b, mk(a, s, { frequency: "never" }))).scheduled_transaction;
    const res = await send(`${S(b)}/bulk?today=${TODAY}`, "POST", {
      op: "enter_now",
      ids: [one.id, one.id],
    });
    expect(res.status).toBe(201);
    expect(await real(b, a)).toHaveLength(1);
    expect(await real(b, s)).toHaveLength(1);
    expect(await list(b)).toHaveLength(0);
  });

  it.each(["series", "mirror"])("Delete from the %s side removes the series", async (side) => {
    const { b, a, s } = await two();
    const made = (await sched(b, mk(a, s))).scheduled_transaction;
    const listed = (await list(b, side === "series" ? a : s))[0];
    const res = await send(`${S(b)}/${listed.id}`, "DELETE");
    expect(res.status).toBe(200);
    expect(await list(b, a)).toHaveLength(0);
    expect(await list(b, s)).toHaveLength(0);
    expect((await send(`${S(b)}/${made.id}`, "GET")).status).toBe(404);
  });

  it("a past date_first enters both sides on create", async () => {
    const { b, a, s } = await two();
    const made = await sched(b, mk(a, s, { date_first: "2026-11-01" }));
    expect(made.transaction.date).toBe("2026-11-01");
    const ra = await real(b, a);
    const rb = await real(b, s);
    expect(ra).toHaveLength(1);
    expect(rb).toHaveLength(1);
    expect(ra[0].transfer_transaction_id).toBe(rb[0].id);
    expect(rb[0].approved).toBe(0);
  });
});

describe("scheduled transfers: the due-job", () => {
  async function due(b: string, a: string, s: string) {
    const made = (await sched(b, mk(a, s, { date_first: "2026-11-20" }))).scheduled_transaction;
    return made;
  }
  it("enters both rows unapproved on the occurrence date, linked, and advances", async () => {
    const { b, a, s } = await two();
    const made = await due(b, a, s);
    const res = await enterDueRest(b, "2026-11-21");
    expect(res.status).toBe(200);
    const out = await body(res);
    expect(out.entered).toHaveLength(1);
    expect(out.entered[0].scheduled_transaction_id).toBe(made.id);
    const ra = await real(b, a);
    const rb = await real(b, s);
    expect(ra[0]).toMatchObject({
      date: "2026-11-20",
      approved: 0,
      transfer_transaction_id: rb[0].id,
    });
    expect(rb[0]).toMatchObject({
      date: "2026-11-20",
      approved: 0,
      amount: 100000,
      transfer_transaction_id: ra[0].id,
    });
    expect(out.entered[0].transaction_id).toBe(ra[0].id);
    expect((await list(b, s))[0].date_next).toBe("2026-12-20");
  });

  it("the cron path does the same", async () => {
    const { b, a, s } = await two();
    await due(b, a, s);
    await cronRun(env, new Date("2026-11-21T03:00:00Z"));
    expect(await real(b, a)).toHaveLength(1);
    expect(await real(b, s)).toHaveLength(1);
  });

  it("plain and transfer schedules due together are each entered right", async () => {
    const { b, a, s } = await two();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const input =
        i % 2 === 0
          ? mk(a, s, { date_first: `2026-11-${10 + i}`, amount: -1000 - i })
          : {
              account_id: a,
              date_first: `2026-11-${10 + i}`,
              frequency: "monthly",
              amount: -1000 - i,
              payee_name: "ZZ Plain",
            };
      ids.push((await sched(b, input, "2026-11-01")).scheduled_transaction.id);
    }
    const out = await body(await enterDueRest(b, "2026-11-21"));
    expect(out.entered).toHaveLength(6);
    expect(await real(b, a)).toHaveLength(6);
    expect(await real(b, s)).toHaveLength(3);
  });

  it("a transfer whose other account is closed is not entered until it is reopened", async () => {
    const { b, a, s } = await two();
    await due(b, a, s);
    expect((await send(`/api/v1/budgets/${b}/accounts/${s}/close`, "POST", {})).status).toBe(200);
    expect((await body(await enterDueRest(b, "2026-11-21"))).entered).toHaveLength(0);
    expect((await send(`/api/v1/budgets/${b}/accounts/${s}/reopen`, "POST", {})).status).toBe(200);
    expect((await body(await enterDueRest(b, "2026-11-21"))).entered).toHaveLength(1);
  });
});

describe("scheduled transfers: REST = MCP", () => {
  const parse = (r: Json): Json => JSON.parse(r.content[0].text);
  const strip = (x: Json): Json =>
    JSON.parse(
      JSON.stringify(x, (k, v) =>
        [
          "id",
          "created_at",
          "updated_at",
          "account_id",
          "transfer_account_id",
          "transfer_transaction_id",
          "transaction_id",
          "budget_id",
        ].includes(k)
          ? undefined
          : v,
      ),
    );
  it("the tools give the same results as REST on twin plans", async () => {
    const rest = await two();
    const mcp = await two();
    // names differ per plan: compare shapes with the account names blanked
    const norm = (x: Json, p: { a: string; s: string }): Json =>
      JSON.parse(
        JSON.stringify(strip(x), (_k, v) =>
          typeof v === "string" ? v.replaceAll(/ZZ [0-9a-f]{8}/g, "ZZ X") : v,
        ),
      );
    const rc = (await sched(rest.b, mk(rest.a, rest.s))).scheduled_transaction;
    const mc = parse(
      await tool("create_scheduled_transaction", {
        budget_id: mcp.b,
        ...mk(mcp.a, mcp.s),
        today: TODAY,
      }),
    ).scheduled_transaction;
    expect(norm(mc, mcp)).toEqual(norm(rc, rest));
    expect(mc.transfer_account_id).toBe(mcp.s);

    const rl = await list(rest.b, rest.s);
    const ml = parse(
      await tool("list_scheduled_transactions", { budget_id: mcp.b, account_id: mcp.s }),
    ).scheduled_transactions;
    expect(ml[0].mirror).toBe(true);
    expect(norm(ml, mcp)).toEqual(norm(rl, rest));

    const ru = (
      await body(await send(`${S(rest.b)}/${rc.id}?today=${TODAY}`, "PATCH", { memo: "ZZ-TEST x" }))
    ).scheduled_transaction;
    const mu = parse(
      await tool("update_scheduled_transaction", {
        budget_id: mcp.b,
        id: mc.id,
        memo: "ZZ-TEST x",
        today: TODAY,
      }),
    ).scheduled_transaction;
    expect(norm(mu, mcp)).toEqual(norm(ru, rest));

    const re = await body(await enter(rest.b, rc.id));
    const me = parse(
      await tool("enter_scheduled_transaction_now", { budget_id: mcp.b, id: mc.id, today: TODAY }),
    );
    expect(norm(me, mcp)).toEqual(norm(re, rest));
    expect(await real(mcp.b, mcp.s)).toHaveLength(1);

    const rd = await body(await send(`${S(rest.b)}/${rc.id}`, "DELETE"));
    const md = parse(await tool("delete_scheduled_transaction", { budget_id: mcp.b, id: mc.id }));
    expect(norm(md, mcp)).toEqual(norm(rd, rest));
    expect(await list(mcp.b)).toHaveLength(0);
  });
});
