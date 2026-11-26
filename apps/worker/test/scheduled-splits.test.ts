import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { enterDue } from "../src/services/scheduled-transactions";
import { actor, tool } from "./bulk-helpers";
import {
  account,
  body,
  category,
  enter,
  type Json,
  plan,
  q,
  realRows,
  S,
  sched,
  send,
  setNext,
  TODAY,
} from "./scheduled-helpers";

const lines = (a: string, b: string) => [
  { amount: -30000, category_id: a },
  { amount: -10000, category_id: b, memo: "ZZ-TEST line" },
];
const split = (acct: string, a: string, b: string, extra: Json = {}) => ({
  account_id: acct,
  date_first: "2026-11-28",
  frequency: "monthly",
  amount: -40000,
  memo: "ZZ-TEST split",
  subtransactions: lines(a, b),
  ...extra,
});
async function setup() {
  const b = await plan();
  const a = await account(b);
  const c1 = await category(b, "Groceries");
  const c2 = await category(b, "Transportation");
  return { b, a, c1, c2 };
}
const patch = (b: string, id: string, input: Json) =>
  send(`${S(b)}/${id}?today=${TODAY}`, "PATCH", input);
const post = (b: string, input: Json) => send(`${S(b)}?today=${TODAY}`, "POST", input);

describe("scheduled splits: REST", () => {
  it("creates a split with its lines in order", async () => {
    const { b, a, c1, c2 } = await setup();
    const s = (await sched(b, split(a, c1, c2))).scheduled_transaction;
    expect(s.category_id).toBeNull();
    expect(s.amount).toBe(-40000);
    expect(s.subtransactions.map((l: Json) => l.amount)).toEqual([-30000, -10000]);
    expect(s.subtransactions[0].category_name).toBeTruthy();
    expect(s.subtransactions[0].category_group_name).toBeTruthy();
    expect(s.subtransactions[1].memo).toBe("ZZ-TEST line");
  });

  it("refuses lines that do not add up, one line, a parent category and a transfer", async () => {
    const { b, a, c1, c2 } = await setup();
    expect((await post(b, split(a, c1, c2, { amount: 0 }))).status).toBe(422);
    expect(
      (await post(b, split(a, c1, c2, { subtransactions: [{ amount: -40000, category_id: c1 }] })))
        .status,
    ).toBe(422);
    expect((await post(b, split(a, c1, c2, { category_id: c1 }))).status).toBe(422);
    const other = await account(b, "savings", 0);
    expect((await post(b, split(a, c1, c2, { transfer_account_id: other }))).status).toBe(422);
    const tracking = await account(b, "otherAsset", 0);
    expect((await post(b, split(tracking, c1, c2))).status).toBe(422);
  });

  it("lists lines on get, list; a plain schedule has none", async () => {
    const { b, a, c1, c2 } = await setup();
    const s = (await sched(b, split(a, c1, c2))).scheduled_transaction;
    const plain = (
      await sched(b, { account_id: a, date_first: "2026-11-29", frequency: "monthly", amount: -5 })
    ).scheduled_transaction;
    const list = (await body(await send(`${S(b)}?today=${TODAY}&account_id=${a}`, "GET")))
      .scheduled_transactions;
    expect(list.find((x: Json) => x.id === s.id).subtransactions).toHaveLength(2);
    expect(list.find((x: Json) => x.id === plain.id).subtransactions).toEqual([]);
  });

  it("patch replaces the lines and can make the schedule plain", async () => {
    const { b, a, c1, c2 } = await setup();
    const s = (await sched(b, split(a, c1, c2))).scheduled_transaction;
    const r = await patch(b, s.id, {
      amount: -45000,
      subtransactions: [
        { amount: -30000, category_id: c1 },
        { amount: -15000, category_id: c2 },
      ],
    });
    expect(r.status).toBe(200);
    const upd = (await body(r)).scheduled_transaction;
    expect(upd.subtransactions.map((l: Json) => l.amount)).toEqual([-30000, -15000]);
    expect((await patch(b, s.id, { amount: -1 })).status).toBe(422);
    const plain = await patch(b, s.id, { subtransactions: [], amount: -45000, category_id: c1 });
    expect(plain.status).toBe(200);
    expect((await body(plain)).scheduled_transaction.subtransactions).toEqual([]);
  });

  it("delete removes the schedule from the list", async () => {
    const { b, a, c1, c2 } = await setup();
    const s = (await sched(b, split(a, c1, c2))).scheduled_transaction;
    expect((await send(`${S(b)}/${s.id}`, "DELETE")).status).toBe(200);
    const list = (await body(await send(`${S(b)}?today=${TODAY}`, "GET"))).scheduled_transactions;
    expect(list).toHaveLength(0);
  });

  it("Enter Now makes a real split dated today, and the due job does too", async () => {
    const { b, a, c1, c2 } = await setup();
    const s = (await sched(b, split(a, c1, c2))).scheduled_transaction;
    const res = await enter(b, s.id);
    expect(res.status).toBe(201);
    const out = await body(res);
    expect(out.transaction.date).toBe(TODAY);
    expect(out.transaction.category_id).toBeNull();
    expect(out.transaction.subtransactions.map((l: Json) => l.amount)).toEqual([-30000, -10000]);
    expect(out.scheduled_transaction.date_next).toBe("2026-12-28");
    const kids = await q(
      "select split_index, amount, category_id, memo from transactions where parent_transaction_id = ? order by split_index",
      out.transaction.id,
    );
    expect(kids.map((k) => k.split_index)).toEqual([0, 1]);
    // the due job
    await setNext(s.id, "2026-11-10", "2026-10-10");
    const due = await enterDue(env, { budgetIds: [b], day: TODAY, actor });
    expect(due.entered).toHaveLength(1);
    const real = await realRows(b, a);
    const parent = real.find((r) => r.id === due.entered[0]?.transaction_id);
    expect(parent?.approved).toBe(0);
    const k2 = await q(
      "select count(*) n from transactions where parent_transaction_id = ?",
      parent?.id,
    );
    expect(k2[0]?.n).toBe(2);
  });
});

describe("scheduled splits: REST = MCP", () => {
  it("the same create gives the same body", async () => {
    const { b, a, c1, c2 } = await setup();
    const input = split(a, c1, c2);
    const rest = (await sched(b, input)).scheduled_transaction;
    const r = await tool("create_scheduled_transaction", { budget_id: b, ...input, today: TODAY });
    const mcp = JSON.parse(r.result.content[0].text).scheduled_transaction;
    const norm = (x: Json) => ({
      ...x,
      id: 0,
      created_at: 0,
      updated_at: 0,
      subtransactions: x.subtransactions.map((l: Json) => ({ ...l, id: 0 })),
    });
    expect(norm(mcp)).toEqual(norm(rest));
  });
});
