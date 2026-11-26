import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { bulkScheduled, updateScheduled } from "../src/services/scheduled-transactions";
import { tool } from "./account-helpers";
import { actor } from "./bulk-helpers";
import {
  account,
  body,
  category,
  type Json,
  plan,
  q,
  S,
  sched,
  send,
  TODAY,
} from "./scheduled-helpers";
import { listedToolNames } from "./surface";
import { setOf, undo } from "./undo-helpers";

const mk = (a: string, n: number, extra: Json = {}) => ({
  account_id: a,
  date_first: "2026-12-01",
  frequency: "monthly",
  amount: -1000 * (n + 1),
  payee_name: `ZZ-TEST Payee ${n}`,
  memo: `ZZ-TEST memo ${n}`,
  ...extra,
});
const bulk = (b: string, req: Json) => send(`${S(b)}/bulk?today=${TODAY}`, "POST", req);
const ok = async (b: string, req: Json) => {
  const res = await bulk(b, req);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  return { res, data: await body(res) };
};
const refused = async (b: string, req: Json, status = 422) => {
  const res = await bulk(b, req);
  const j = (await res.json()) as Json;
  expect(res.status, JSON.stringify(j)).toBe(status);
  return j;
};
const row = async (id: string) =>
  (
    await q(
      "select account_id, category_id, inflow_to_ready_to_assign inflow, flag_color, memo from scheduled_transactions where id = ?",
      id,
    )
  )[0] as Json;
const logsOf = (id: string) =>
  q(
    "select actor, action, entity_type, change_set_id, before_json, after_json from change_log where entity_id = ? order by rowid",
    id,
  );
const total = async (b: string) =>
  (await q("select count(*) n from change_log where budget_id = ?", b))[0]?.n as number;

async function world() {
  const b = await plan();
  const a = await account(b, "checking", 0);
  const s = await account(b, "savings", 0);
  const t = await account(b, "otherAsset", 0);
  const c = await category(b, "Groceries");
  const c2 = await category(b, "Transportation");
  const s1 = (await sched(b, mk(a, 1))).scheduled_transaction.id as string;
  const s2 = (await sched(b, mk(a, 2))).scheduled_transaction.id as string;
  return { b, a, s, t, c, c2, s1, s2 };
}

type W = Awaited<ReturnType<typeof world>>;
const OPS: { name: string; req: (w: W) => Json; check: (r: Json) => void; restored: Json }[] = [
  {
    name: "categorize",
    req: (w) => ({ op: "categorize", ids: [w.s1, w.s2], value: w.c }),
    check: (r) => expect(r.category_id).toBeTruthy(),
    restored: { category_id: null },
  },
  {
    name: "flag",
    req: (w) => ({ op: "flag", ids: [w.s1, w.s2], value: "red" }),
    check: (r) => expect(r.flag_color).toBe("red"),
    restored: { flag_color: null },
  },
  {
    name: "memo",
    req: (w) => ({ op: "memo", ids: [w.s1, w.s2], value: "ZZ-TEST bulk memo" }),
    check: (r) => expect(r.memo).toBe("ZZ-TEST bulk memo"),
    restored: {},
  },
  {
    name: "move",
    req: (w) => ({ op: "move", ids: [w.s1, w.s2], value: w.s }),
    check: (r) => expect(r.account_id).toBeTruthy(),
    restored: {},
  },
];

describe("scheduled bulk update: REST", () => {
  for (const op of OPS) {
    it(`${op.name}: updates, logs once each, one change set`, async () => {
      const w = await world();
      if (op.name === "move") {
        // schedule 2 is already in the target: skipped as unchanged
        await updateScheduled(env, actor, w.b, w.s2, { account_id: w.s }, TODAY);
      }
      const before = await total(w.b);
      const { res, data } = await ok(w.b, op.req(w));
      expect(data.op).toBe(op.name);
      if (op.name === "move") {
        expect(data.results.map((r: Json) => r.id)).toEqual([w.s1]);
        expect(data.skipped).toEqual([{ id: w.s2, reason: "unchanged" }]);
        expect((await row(w.s1)).account_id).toBe(w.s);
      } else {
        expect(data.results).toHaveLength(2);
        expect(data.skipped).toEqual([]);
        for (const r of data.results) {
          expect(r.transaction).toBeNull();
          op.check(r.scheduled_transaction);
        }
      }
      expect(await total(w.b)).toBe(before + data.results.length);
      const set = setOf(res);
      for (const r of data.results) {
        const l = await logsOf(r.id);
        const last = l[l.length - 1] as Json;
        expect(l.filter((x) => x.action === "update")).toHaveLength(1);
        expect(last).toMatchObject({
          action: "update",
          entity_type: "scheduled_transaction",
          change_set_id: set,
        });
        expect(last.actor).toMatch(/^user:/);
        expect(last.before_json).not.toBe(last.after_json);
      }
    });

    it(`${op.name}: undo restores the schedules`, async () => {
      const w = await world();
      const was = [await row(w.s1), await row(w.s2)];
      const { res } = await ok(w.b, op.req(w));
      expect(await row(w.s1)).not.toEqual(was[0]);
      const u = await undo(w.b, setOf(res));
      expect(u.status, JSON.stringify(u.body)).toBe(200);
      expect([await row(w.s1), await row(w.s2)]).toEqual(was);
    });

    it(`${op.name}: REST = MCP on twin plans`, async () => {
      const strip = (x: Json): Json =>
        JSON.parse(
          JSON.stringify(x, (k, v) =>
            [
              "id",
              "account_id",
              "category_id",
              "created_at",
              "updated_at",
              "budget_id",
              "payee_id",
              "transfer_account_id",
            ].includes(k)
              ? undefined
              : typeof v === "string"
                ? v.replaceAll(/ZZ [0-9a-f]{8}/g, "ZZ X")
                : v,
          ),
        );
      const rest = await world();
      const mcp = await world();
      const { data } = await ok(rest.b, op.req(rest));
      const { op: name, ...args } = op.req(mcp);
      const r = await tool("bulk_update_scheduled_transactions", {
        budget_id: mcp.b,
        op: name,
        ...args,
      });
      expect(r.isError, JSON.stringify(r)).toBeFalsy();
      const m = JSON.parse(r.content[0].text);
      expect(strip(m)).toEqual(strip(data));
      const l = (await logsOf(mcp.s1)) as Json[];
      const last = l[l.length - 1] as Json;
      expect(last.actor).toMatch(/^mcp:/);
      const sets = new Set(
        [...(await logsOf(mcp.s1)), ...(await logsOf(mcp.s2))]
          .filter((x) => x.action === "update")
          .map((x) => x.change_set_id),
      );
      expect(sets.size).toBe(1);
    });
  }
});

describe("scheduled bulk update: categorize", () => {
  it("skips splits, tracking, on-plan transfers and unchanged; applies the two tracking transfers", async () => {
    const w = await world();
    const split = (
      await sched(w.b, {
        account_id: w.a,
        date_first: "2026-12-01",
        frequency: "monthly",
        amount: -40000,
        subtransactions: [
          { amount: -30000, category_id: w.c },
          { amount: -10000, category_id: w.c2 },
        ],
      })
    ).scheduled_transaction.id;
    const trk = (await sched(w.b, mk(w.t, 3))).scheduled_transaction.id;
    const onOn = (await sched(w.b, mk(w.a, 4, { transfer_account_id: w.s, payee_name: undefined })))
      .scheduled_transaction.id;
    const onTrk = (
      await sched(w.b, mk(w.a, 5, { transfer_account_id: w.t, payee_name: undefined }))
    ).scheduled_transaction.id;
    const trkOn = (
      await sched(w.b, mk(w.t, 6, { transfer_account_id: w.a, payee_name: undefined }))
    ).scheduled_transaction.id;
    await ok(w.b, { op: "categorize", ids: [w.s2], value: w.c });
    const { data } = await ok(w.b, {
      op: "categorize",
      ids: [w.s1, w.s2, split, trk, onOn, onTrk, trkOn],
      value: w.c,
    });
    const reasons = Object.fromEntries(data.skipped.map((s: Json) => [s.id, s.reason]));
    expect(reasons).toEqual({
      [w.s2]: "unchanged",
      [split]: "split",
      [trk]: "tracking_account",
      [onOn]: "category_not_needed",
    });
    expect(data.results.map((r: Json) => r.id).sort()).toEqual([w.s1, onTrk, trkOn].sort());
    expect((await row(onTrk)).category_id).toBe(w.c);
    expect((await row(trkOn)).category_id).toBe(w.c);
    expect((await row(split)).category_id).toBeNull();
  });

  it("ready_to_assign clears the category and sets the mark", async () => {
    const w = await world();
    await ok(w.b, { op: "categorize", ids: [w.s1], value: w.c });
    await ok(w.b, { op: "categorize", ids: [w.s1], value: "ready_to_assign" });
    expect(await row(w.s1)).toMatchObject({ category_id: null, inflow: 1 });
    await ok(w.b, { op: "categorize", ids: [w.s1], value: w.c });
    expect(await row(w.s1)).toMatchObject({ category_id: w.c, inflow: 0 });
  });

  it("refuses an unknown category and a card's own payment category, writing nothing", async () => {
    const w = await world();
    const visa = await account(w.b, "creditCard", 0);
    const vs = (await sched(w.b, mk(visa, 7))).scheduled_transaction.id;
    const pay = (
      await q("select id from categories where budget_id = ? and account_id = ?", w.b, visa)
    )[0]?.id as string;
    const before = await total(w.b);
    await refused(w.b, { op: "categorize", ids: [w.s1], value: "nope" });
    const j = await refused(w.b, { op: "categorize", ids: [w.s1, vs], value: pay });
    expect(j.error.name).toBe("own_payment_category");
    expect(await total(w.b)).toBe(before);
    expect((await row(w.s1)).category_id).toBeNull();
  });
});

describe("scheduled bulk update: mirrors", () => {
  it("categorize, flag and memo through a mirror's series id change the series", async () => {
    const w = await world();
    const t = (await sched(w.b, mk(w.a, 3, { transfer_account_id: w.t, payee_name: undefined })))
      .scheduled_transaction.id;
    await ok(w.b, { op: "flag", ids: [t], value: "blue" });
    await ok(w.b, { op: "memo", ids: [t], value: "ZZ-TEST via mirror" });
    await ok(w.b, { op: "categorize", ids: [t], value: w.c });
    expect(await row(t)).toMatchObject({ flag_color: "blue", memo: "ZZ-TEST via mirror" });
  });

  it("move skips the ids named in mirror_ids and moves the plain one", async () => {
    const w = await world();
    const t = (await sched(w.b, mk(w.a, 3, { transfer_account_id: w.s, payee_name: undefined })))
      .scheduled_transaction.id;
    const { data } = await ok(w.b, {
      op: "move",
      ids: [t, w.s1],
      value: w.t,
      mirror_ids: [t],
    });
    expect(data.skipped).toEqual([{ id: t, reason: "mirror" }]);
    expect(data.results.map((r: Json) => r.id)).toEqual([w.s1]);
    expect((await row(t)).account_id).toBe(w.a);
    expect((await row(w.s1)).account_id).toBe(w.t);
  });

  it("refuses mirror_ids outside ids (422)", async () => {
    const w = await world();
    await refused(w.b, { op: "move", ids: [w.s1], value: w.s, mirror_ids: [w.s2] }, 422);
  });
});

describe("scheduled bulk update: move refusals", () => {
  it("each refusal is a 422 and writes nothing", async () => {
    const w = await world();
    const closed = await account(w.b, "checking", 0);
    expect((await send(`/api/v1/budgets/${w.b}/accounts/${closed}/close`, "POST", {})).status).toBe(
      200,
    );
    const trans = (
      await sched(w.b, mk(w.a, 3, { transfer_account_id: w.s, payee_name: undefined }))
    ).scheduled_transaction.id;
    const cat = (await sched(w.b, mk(w.a, 4, { category_id: w.c }))).scheduled_transaction.id;
    const split = (
      await sched(w.b, {
        account_id: w.a,
        date_first: "2026-12-01",
        frequency: "monthly",
        amount: -40000,
        subtransactions: [
          { amount: -30000, category_id: w.c },
          { amount: -10000, category_id: w.c2 },
        ],
      })
    ).scheduled_transaction.id;
    const visa = await account(w.b, "creditCard", 0);
    const pay = (
      await q("select id from categories where budget_id = ? and account_id = ?", w.b, visa)
    )[0]?.id as string;
    const payS = (await sched(w.b, mk(w.a, 5, { category_id: pay }))).scheduled_transaction.id;
    const before = await total(w.b);
    expect((await refused(w.b, { op: "move", ids: [w.s1], value: closed })).error.name).toBe(
      "account_closed",
    );
    await refused(w.b, { op: "move", ids: [w.s1], value: "nope" });
    const into = await refused(w.b, { op: "move", ids: [trans], value: w.s });
    expect(JSON.stringify(into)).toContain("a transfer cannot be moved into its other account");
    expect(JSON.stringify(await refused(w.b, { op: "move", ids: [cat], value: w.t }))).toContain(
      "is a tracking account, so its transactions can't have a category",
    );
    expect(JSON.stringify(await refused(w.b, { op: "move", ids: [split], value: w.t }))).toContain(
      "can't be split",
    );
    expect((await refused(w.b, { op: "move", ids: [payS], value: visa })).error.name).toBe(
      "own_payment_category",
    );
    expect(await total(w.b)).toBe(before);
    expect((await row(w.s1)).account_id).toBe(w.a);
    // a plain uncategorized schedule moves into a tracking account
    await ok(w.b, { op: "move", ids: [w.s1], value: w.t });
    expect((await row(w.s1)).account_id).toBe(w.t);
  });
});

describe("scheduled bulk update: races and missing rows", () => {
  it("a schedule edited between the read and the write is skipped as changed", async () => {
    const w = await world();
    const before = (await logsOf(w.s1)).length;
    const r = await bulkScheduled(
      env,
      actor,
      w.b,
      { op: "flag", ids: [w.s1, w.s2], value: "green" },
      TODAY,
      {
        beforeWrite: async () => {
          await updateScheduled(env, actor, w.b, w.s1, { memo: "ZZ-TEST raced" }, TODAY);
        },
      },
    );
    expect(r.skipped).toEqual([{ id: w.s1, reason: "changed" }]);
    expect(r.results.map((x) => x.id)).toEqual([w.s2]);
    expect(await logsOf(w.s1)).toHaveLength(before + 1);
    expect((await row(w.s1)).flag_color).toBeNull();
    expect((await row(w.s2)).flag_color).toBe("green");
  });

  it("an unknown id is 404; a closed account and a closed transfer partner are 422", async () => {
    const w = await world();
    const x = await account(w.b, "checking", 0);
    const y = await account(w.b, "checking", 0);
    const onX = (await sched(w.b, mk(x, 8))).scheduled_transaction.id;
    const tr = (await sched(w.b, mk(w.a, 9, { transfer_account_id: y, payee_name: undefined })))
      .scheduled_transaction.id;
    await refused(w.b, { op: "flag", ids: [w.s1, "nope"], value: "red" }, 404);
    for (const id of [x, y]) {
      expect((await send(`/api/v1/budgets/${w.b}/accounts/${id}/close`, "POST", {})).status).toBe(
        200,
      );
    }
    const before = await total(w.b);
    await refused(w.b, { op: "flag", ids: [w.s1, onX], value: "red" });
    expect((await refused(w.b, { op: "flag", ids: [w.s1, tr], value: "red" })).error.name).toBe(
      "account_closed",
    );
    expect(await total(w.b)).toBe(before);
    expect((await row(w.s1)).flag_color).toBeNull();
  });
});

describe("scheduled bulk update: surface", () => {
  it("lists the MCP tool", async () => {
    expect(await listedToolNames()).toContain("bulk_update_scheduled_transactions");
  });
});
