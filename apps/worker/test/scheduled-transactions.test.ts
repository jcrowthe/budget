import { describe, expect, it } from "vitest";
import { tool } from "./account-helpers";
import { json } from "./helpers";
import {
  account,
  body,
  category,
  enter,
  enterDueRest,
  type Json,
  plan,
  q,
  realRows,
  S,
  sched,
  schedLogs,
  send,
  TODAY,
} from "./scheduled-helpers";
import { apiPaths, listedToolNames } from "./surface";

const base = (a: string, extra: Json = {}) => ({
  account_id: a,
  date_first: "2026-11-20",
  frequency: "never",
  amount: -800000,
  payee_name: "ZZ-TEST Landlord",
  ...extra,
});

describe("scheduled transactions: create and read", () => {
  it("a future one-off is a schedule only: nothing real, balances unchanged", async () => {
    const b = await plan();
    const a = await account(b, "checking", 2500000);
    const r = await sched(b, base(a));
    expect(r.transaction).toBeNull();
    expect(r.scheduled_transaction).toMatchObject({
      amount: -800000,
      date_first: "2026-11-20",
      date_next: "2026-11-20",
      frequency: "never",
      payee_name: "ZZ-TEST Landlord",
      category_id: null,
      deleted: false,
    });
    expect(await realRows(b, a)).toEqual([]);
    const bal = await body(await json(`/api/v1/budgets/${b}/accounts/${a}/transactions`));
    expect(bal.balances).toEqual({ cleared: 2500000, uncleared: 0, working: 2500000 });
    const list = await body(await json(S(b)));
    expect(list.scheduled_transactions).toHaveLength(1);
    const one = await body(await json(`${S(b)}/${r.scheduled_transaction.id}`));
    expect(one.scheduled_transaction.id).toBe(r.scheduled_transaction.id);
  });

  it("accepts 12/31/2032 and an empty category", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await sched(b, base(a, { date_first: "2032-12-31", category_id: null }));
    expect(r.scheduled_transaction.date_next).toBe("2032-12-31");
    expect(r.scheduled_transaction.category_name).toBeNull();
  });

  it("filters the list by account", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    await sched(b, base(a1));
    await sched(b, base(a2));
    const list = await body(await json(`${S(b)}?account_id=${a1}`));
    expect(list.scheduled_transactions.map((s: Json) => s.account_id)).toEqual([a1]);
  });

  it("a date on or before today with a repeat enters one unapproved row and schedules the next", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await sched(b, base(a, { date_first: TODAY, frequency: "weekly" }));
    expect(r.scheduled_transaction.date_next).toBe("2026-11-22");
    expect(r.transaction).toMatchObject({ date: TODAY, approved: false, cleared: "uncleared" });
    expect(await realRows(b, a)).toHaveLength(1);
  });

  it("a date in the past enters one row on that date, not the missed ones", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await sched(b, base(a, { date_first: "2026-11-01", frequency: "weekly" }));
    expect(r.scheduled_transaction.date_next).toBe("2026-11-22");
    const rows = await realRows(b, a);
    expect(rows.map((x) => x.date)).toEqual(["2026-11-01"]);
    expect(rows[0]?.approved).toBe(0);
  });

  it("422: a past date with Never says to create a transaction instead", async () => {
    const b = await plan();
    const a = await account(b);
    const res = await send(`${S(b)}?today=${TODAY}`, "POST", base(a, { date_first: TODAY }));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("create a transaction instead");
  });

  it("422: unknown frequency, impossible date, unsupported fields", async () => {
    const b = await plan();
    const a = await account(b);
    for (const extra of [
      { frequency: "fortnightly" },
      { date_first: "2026-02-30" },
      { transfer_account_id: a },
      { subtransactions: [] },
      { date_next: "2026-12-01" },
    ]) {
      expect((await send(S(b), "POST", base(a, extra))).status, JSON.stringify(extra)).toBe(422);
    }
  });

  it("422: a closed account, and a category on a tracking account", async () => {
    const b = await plan();
    const a = await account(b);
    const t = await account(b, "otherAsset", 1000);
    const c = await category(b);
    const closed = await account(b, "checking", 0);
    expect((await send(`/api/v1/budgets/${b}/accounts/${closed}/close`, "POST", {})).status).toBe(
      200,
    );
    const res = await send(`${S(b)}?today=${TODAY}`, "POST", base(closed));
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("account_closed");
    const tr = await send(`${S(b)}?today=${TODAY}`, "POST", base(t, { category_id: c }));
    expect(tr.status).toBe(422);
    expect(JSON.stringify(await tr.json())).toContain("Tracking accounts do not take a category");
    // a refused create leaves no row, no payee and no log
    expect(await q("select id from scheduled_transactions where budget_id = ?", b)).toEqual([]);
    expect(
      await q("select id from payees where budget_id = ? and name = 'ZZ-TEST Landlord'", b),
    ).toEqual([]);
    expect(a).toBeTruthy();
  });

  it("another plan's id is 404", async () => {
    const b1 = await plan();
    const b2 = await plan();
    const a = await account(b1);
    const r = await sched(b1, base(a));
    const id = r.scheduled_transaction.id;
    expect((await json(`${S(b2)}/${id}`)).status).toBe(404);
    expect((await send(`${S(b2)}/${id}`, "DELETE")).status).toBe(404);
    expect((await enter(b2, id)).status).toBe(404);
  });
});

describe("scheduled transactions: recurrence through Enter Now", () => {
  const walk = async (frequency: string, first: string, n: number) => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, base(a, { date_first: first, frequency }))).scheduled_transaction.id;
    const seen = [first];
    for (let i = 0; i < n; i++) {
      const res = await enter(b, id);
      expect(res.status).toBe(201);
      seen.push((await body(res)).scheduled_transaction.date_next);
    }
    return seen;
  };
  it("monthly from 12/31 keeps the start day", async () => {
    expect(await walk("monthly", "2026-12-31", 4)).toEqual([
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });
  it("monthly from 2028-01-31 reaches 2028-02-29", async () => {
    expect((await walk("monthly", "2028-01-31", 1))[1]).toBe("2028-02-29");
  });
  it("twice a month from the 20th alternates the 5th and the 20th", async () => {
    expect(await walk("twiceAMonth", "2026-11-20", 4)).toEqual([
      "2026-11-20",
      "2026-12-05",
      "2026-12-20",
      "2027-01-05",
      "2027-01-20",
    ]);
  });
  it("twice a month from the 10th and from the 31st", async () => {
    expect(await walk("twiceAMonth", "2026-12-10", 2)).toEqual([
      "2026-12-10",
      "2026-12-25",
      "2027-01-10",
    ]);
    expect(await walk("twiceAMonth", "2027-01-31", 2)).toEqual([
      "2027-01-31",
      "2027-02-16",
      "2027-02-28",
    ]);
  });
});

describe("scheduled transactions: Enter Now", () => {
  it("a monthly series: a real approved uncleared row dated today, one step on", async () => {
    const b = await plan();
    const a = await account(b);
    const c = await category(b);
    const id = (
      await sched(
        b,
        base(a, {
          date_first: "2026-11-25",
          frequency: "monthly",
          category_id: c,
          memo: "ZZ m",
          flag_color: "red",
        }),
      )
    ).scheduled_transaction.id;
    const res = await enter(b, id);
    expect(res.status).toBe(201);
    const d = await body(res);
    expect(d.transaction).toMatchObject({
      date: TODAY,
      approved: true,
      cleared: "uncleared",
      amount: -800000,
      memo: "ZZ m",
      category_id: c,
      flag_color: "red",
      payee_name: "ZZ-TEST Landlord",
    });
    expect(d.scheduled_transaction.date_next).toBe("2026-12-25");
    expect((await realRows(b, a)).map((r) => r.date)).toEqual([TODAY]);
  });

  it("a one-off is removed: 404, delete logged", async () => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, base(a))).scheduled_transaction.id;
    const d = await body(await enter(b, id));
    expect(d.scheduled_transaction.deleted).toBe(true);
    expect(d.transaction.date).toBe(TODAY);
    expect((await json(`${S(b)}/${id}`)).status).toBe(404);
    expect((await schedLogs(id)).map((l) => l.action)).toEqual(["create", "delete"]);
  });

  it("a schedule entered when its account is closed is refused", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    const id = (await sched(b, base(a))).scheduled_transaction.id;
    expect((await send(`/api/v1/budgets/${b}/accounts/${a}/close`, "POST", {})).status).toBe(200);
    const res = await enter(b, id);
    expect(res.status).toBe(422);
    expect((await json(`${S(b)}/${id}`)).status).toBe(404);
    expect((await body(await json(S(b)))).scheduled_transactions).toEqual([]);
  });

  it("bulk enter and bulk delete; an unknown id is 404 for all", async () => {
    const b = await plan();
    const a = await account(b);
    const ids = [
      (await sched(b, base(a, { frequency: "monthly" }))).scheduled_transaction.id,
      (await sched(b, base(a))).scheduled_transaction.id,
    ];
    const bad = await send(`${S(b)}/bulk?today=${TODAY}`, "POST", {
      op: "enter_now",
      ids: [...ids, "nope"],
    });
    expect(bad.status).toBe(404);
    const ok = await send(`${S(b)}/bulk?today=${TODAY}`, "POST", { op: "enter_now", ids });
    expect(ok.status).toBe(201);
    const d = await body(ok);
    expect(d.results).toHaveLength(2);
    expect(d.skipped).toEqual([]);
    expect((await realRows(b, a)).length).toBe(2);
    const del = await send(`${S(b)}/bulk`, "POST", { op: "delete", ids: [ids[0]] });
    expect(del.status).toBe(200);
    expect((await body(await json(S(b)))).scheduled_transactions).toEqual([]);
  });
});

describe("scheduled transactions: edit and delete", () => {
  it("edits the series: memo changes, date_next does not; delete removes it", async () => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, base(a, { frequency: "monthly" }))).scheduled_transaction.id;
    const res = await send(`${S(b)}/${id}?today=${TODAY}`, "PATCH", { memo: "ZZ-TEST rent" });
    expect(res.status).toBe(200);
    const d = await body(res);
    expect(d.scheduled_transaction).toMatchObject({
      memo: "ZZ-TEST rent",
      date_next: "2026-11-20",
    });
    const del = await send(`${S(b)}/${id}`, "DELETE");
    expect(del.status).toBe(200);
    expect((await body(del)).scheduled_transaction.deleted).toBe(true);
    expect((await body(await json(S(b)))).scheduled_transactions).toEqual([]);
    expect((await schedLogs(id)).map((l) => [l.action, l.entity_type])).toEqual([
      ["create", "scheduled_transaction"],
      ["update", "scheduled_transaction"],
      ["delete", "scheduled_transaction"],
    ]);
  });

  it("changing the date moves the anchor; a past date with Never is refused", async () => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, base(a, { frequency: "monthly" }))).scheduled_transaction.id;
    const moved = await body(
      await send(`${S(b)}/${id}?today=${TODAY}`, "PATCH", { date_first: "2026-12-05" }),
    );
    expect(moved.scheduled_transaction).toMatchObject({
      date_first: "2026-12-05",
      date_next: "2026-12-05",
    });
    const never = await send(`${S(b)}/${id}?today=${TODAY}`, "PATCH", {
      date_first: TODAY,
      frequency: "never",
    });
    expect(never.status).toBe(422);
    expect(JSON.stringify(await never.json())).toContain("Enter Now");
  });

  it("changing only the frequency re-anchors at date_next", async () => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, base(a, { frequency: "monthly", date_first: "2026-12-31" })))
      .scheduled_transaction.id;
    const d = await body(
      await send(`${S(b)}/${id}?today=${TODAY}`, "PATCH", { frequency: "weekly" }),
    );
    expect(d.scheduled_transaction).toMatchObject({
      date_first: "2026-12-31",
      date_next: "2026-12-31",
      frequency: "weekly",
    });
  });

  it("an empty patch is 422", async () => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, base(a))).scheduled_transaction.id;
    expect((await send(`${S(b)}/${id}`, "PATCH", {})).status).toBe(422);
  });
});

describe("scheduled transactions: entering what is due", () => {
  it("enters one unapproved row dated its date, advances, and does nothing the second time", async () => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, base(a, { date_first: "2026-11-16", frequency: "weekly" })))
      .scheduled_transaction.id;
    const first = await body(await enterDueRest(b, "2026-11-16"));
    expect(first.entered).toHaveLength(1);
    expect(first.entered[0]).toMatchObject({ scheduled_transaction_id: id, date: "2026-11-16" });
    const rows = await realRows(b, a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-11-16", approved: 0, cleared: "uncleared" });
    expect((await body(await json(`${S(b)}/${id}`))).scheduled_transaction.date_next).toBe(
      "2026-11-23",
    );
    const again = await body(await enterDueRest(b, "2026-11-16"));
    expect(again.entered).toEqual([]);
    expect(await realRows(b, a)).toHaveLength(1);
    const logs = await q(
      "select actor from change_log where entity_id = ? and action = 'update'",
      id,
    );
    expect(logs.map((l) => l.actor)).toEqual(["service:scheduler"]);
  });

  it("missed occurrences are not entered; a one-off is removed", async () => {
    const b = await plan();
    const a = await account(b);
    await sched(b, base(a, { date_first: "2026-12-01", frequency: "weekly" }), "2026-11-15");
    await sched(b, base(a, { date_first: "2026-12-02" }), "2026-11-15");
    const d = await body(await enterDueRest(b, "2026-12-20"));
    expect(d.entered).toHaveLength(2);
    const rows = await realRows(b, a);
    expect(rows.map((r) => r.date).sort()).toEqual(["2026-12-01", "2026-12-02"]);
    const list = (await body(await json(S(b)))).scheduled_transactions;
    expect(list.map((s: Json) => s.date_next)).toEqual(["2026-12-22"]);
  });

  it("leaves schedules of a closed account alone and enters them again once it is reopened", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    await sched(b, base(a, { date_first: "2026-11-16", frequency: "weekly" }));
    expect((await send(`/api/v1/budgets/${b}/accounts/${a}/close`, "POST", {})).status).toBe(200);
    expect((await body(await enterDueRest(b, "2026-11-16"))).entered).toEqual([]);
    expect((await send(`/api/v1/budgets/${b}/accounts/${a}/reopen`, "POST", {})).status).toBe(200);
    expect((await body(await enterDueRest(b, "2026-11-16"))).entered).toHaveLength(1);
  });

  it("enter-due on an unknown plan is 404", async () => {
    expect((await enterDueRest("nope")).status).toBe(404);
  });

  it("a due inflow to Ready to Assign adds nothing until it is entered", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    const rta = async () =>
      (await body(await json(`/api/v1/budgets/${b}/months/2026-11-01`))).ready_to_assign as number;
    const before = await rta();
    await sched(
      b,
      base(a, { date_first: "2026-11-20", amount: 500000, inflow_to_ready_to_assign: true }),
    );
    expect(await rta()).toBe(before);
  });
});

describe("scheduled transactions: MCP and surface", () => {
  it("lists its paths and tools", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/scheduled-transactions",
        "/api/v1/budgets/{budget_id}/scheduled-transactions/{scheduled_transaction_id}",
        "/api/v1/budgets/{budget_id}/scheduled-transactions/{scheduled_transaction_id}/enter",
        "/api/v1/budgets/{budget_id}/scheduled-transactions/bulk",
        "/api/v1/budgets/{budget_id}/scheduled-transactions/enter-due",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "list_scheduled_transactions",
        "get_scheduled_transaction",
        "create_scheduled_transaction",
        "update_scheduled_transaction",
        "delete_scheduled_transaction",
        "enter_scheduled_transaction_now",
        "enter_due_scheduled_transactions",
      ]),
    );
  });

  const parse = (r: Json): Json => JSON.parse(r.content[0].text);
  it("the tools create, list, update, enter, enter due and delete, with their actors", async () => {
    const b = await plan();
    const a = await account(b);
    const made = parse(
      await tool("create_scheduled_transaction", {
        budget_id: b,
        account_id: a,
        date_first: "2026-11-20",
        frequency: "monthly",
        amount: -1000,
        today: TODAY,
      }),
    );
    const id = made.scheduled_transaction.id;
    expect(
      parse(await tool("list_scheduled_transactions", { budget_id: b })).scheduled_transactions,
    ).toHaveLength(1);
    expect(
      parse(await tool("get_scheduled_transaction", { budget_id: b, id })).scheduled_transaction.id,
    ).toBe(id);
    const upd = parse(
      await tool("update_scheduled_transaction", { budget_id: b, id, memo: "ZZ", today: TODAY }),
    );
    expect(upd.scheduled_transaction.memo).toBe("ZZ");
    const ent = parse(
      await tool("enter_scheduled_transaction_now", { budget_id: b, id, today: TODAY }),
    );
    expect(ent.transaction.date).toBe(TODAY);
    const due = parse(
      await tool("enter_due_scheduled_transactions", { budget_id: b, today: TODAY }),
    );
    expect(due.entered).toEqual([]);
    const del = parse(await tool("delete_scheduled_transaction", { budget_id: b, id }));
    expect(del.scheduled_transaction.deleted).toBe(true);
    const actors = (await schedLogs(id)).map((l) => l.actor);
    expect(actors.every((x) => x.startsWith("mcp:"))).toBe(true);
    expect(actors).toHaveLength(4);
    const refused = await tool("create_scheduled_transaction", {
      budget_id: b,
      account_id: a,
      date_first: TODAY,
      amount: -1,
      today: TODAY,
    });
    expect(refused.isError).toBe(true);
  });

  it("REST writes carry the user's actor", async () => {
    const b = await plan();
    const a = await account(b);
    const id = (await sched(b, base(a))).scheduled_transaction.id;
    expect((await schedLogs(id))[0]?.actor).toMatch(/^user:/);
  });
});
