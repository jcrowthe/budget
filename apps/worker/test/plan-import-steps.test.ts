import { env } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import type { Env } from "../src/env";
import { insertRowsStmts } from "../src/repositories/plan-import";
import { planClock } from "../src/services/plan-clock";
import { continueImport, importLimits } from "../src/services/plan-import";
import { enterDue } from "../src/services/scheduled-transactions";
import { type Json, q, tool } from "./bulk-helpers";
import { authed, call, json } from "./helpers";
import { buildF, NOW, pinPlanClock, readZip } from "./plan-export-helpers";
import {
  allCounts,
  body,
  continueImportRest,
  importForm,
  planCounts,
  postImport,
  r2Keys,
  runToDone,
  sampleFiles,
  TABLES_OF_PLAN,
} from "./plan-import-helpers";

// EXF-477, cases 8 and 9: the steps, the invisibility of a half-imported plan, the cleanup.
pinPlanClock();

const saved = { ...importLimits };
beforeAll(() => {
  importLimits.chunkRows = 7;
  importLimits.singleCallRows = 0;
});
afterAll(() => Object.assign(importLimits, saved));

async function exportZip() {
  const f = await buildF();
  const res = await json(`/api/v1/budgets/${f.bid}/export?now=${encodeURIComponent(NOW)}`);
  const name = /filename="([^"]+)"/.exec(
    res.headers.get("Content-Disposition") ?? "",
  )?.[1] as string;
  return { name, data: new Uint8Array(await res.arrayBuffer()), f };
}
const start = async () => {
  const z = await exportZip();
  const data = await body(await postImport(importForm([{ name: z.name, data: z.data }])), 202);
  const bid = (await q("select budget_id from plan_imports where id = ?", data.import_id))[0]
    ?.budget_id as string;
  return { data, bid, z };
};
const status = async (path: string) => (await json(path)).status;

describe("case 8: the steps", () => {
  it("202 then 201; nothing of the plan is visible before the last step", async () => {
    const { data: first, bid } = await start();
    expect(first.state).toBe("writing");
    expect(first.budget_id).toBeNull();
    expect(JSON.stringify(first)).not.toContain(bid);
    let data = first;
    let steps = 0;
    for (;;) {
      // The plan row exists, hidden; every read path answers as if it were absent.
      expect(
        (await q("select deleted_at from budgets where id = ?", bid))[0]?.deleted_at,
      ).not.toBeNull();
      const list = ((await (await json("/api/v1/budgets")).json()) as Json).data.budgets as Json[];
      expect(list.map((b) => b.id)).not.toContain(bid);
      expect(await status(`/api/v1/budgets/${bid}`)).toBe(404);
      expect(await status(`/api/v1/budgets/${bid}/accounts`)).toBe(404);
      expect(await status(`/api/v1/budgets/${bid}/months/2026-10-01`)).toBe(404);
      expect(await status(`/api/v1/budgets/${bid}/export?now=${encodeURIComponent(NOW)}`)).toBe(
        404,
      );
      const viaTool = await tool("get_budget", { budget_id: bid });
      expect(viaTool.result.isError).toBe(true);
      const listed = JSON.parse((await tool("list_budgets", {})).result.content[0].text)
        .budgets as Json[];
      expect(listed.map((b) => b.id)).not.toContain(bid);
      const history = (await q("select count(*) n from change_log where budget_id = ?", bid))[0]?.n;
      expect(history).toBe(0);
      const before = await planCounts(bid);
      const entered = await enterDue(env, {
        budgetIds: "all",
        day: "2199-01-01",
        actor: "service:test",
      });
      expect(entered.entered.map((e) => (e as Json).budget_id ?? "")).not.toContain(bid);
      expect(await planCounts(bid)).toEqual(before);
      const res = await continueImportRest(first.import_id);
      steps++;
      data = ((await res.json()) as Json).data;
      if (data.state === "done") {
        expect(res.status).toBe(201);
        break;
      }
      expect(res.status).toBe(202);
      expect(data.budget_id).toBeNull();
      expect(data.progress.chunks_done).toBe(steps);
    }
    expect(steps).toBe(first.progress.chunk_count);
    expect(data.budget_id).toBe(bid);
    expect(await status(`/api/v1/budgets/${bid}`)).toBe(200);
    expect((await q("select count(*) n from change_log where budget_id = ?", bid))[0]?.n).toBe(1);
    expect(await r2Keys()).toEqual([]);
    expect(
      (await q("select r2_key, state from plan_imports where id = ?", first.import_id))[0],
    ).toMatchObject({ r2_key: null, state: "done" });
  });

  it("two concurrent continues and a repeated one leave the rows of one import", async () => {
    importLimits.singleCallRows = 2500;
    const z = await exportZip();
    const single = await body(await postImport(importForm([{ name: z.name, data: z.data }])), 201);
    const expected = await planCounts(single.budget_id);
    importLimits.singleCallRows = 0;

    const { data: first, bid } = await start();
    // Two at once, at every step.
    let data = first;
    while (data.state !== "done") {
      const [a, b] = await Promise.all([
        continueImportRest(first.import_id),
        continueImportRest(first.import_id),
      ]);
      expect([201, 202, 409, 422]).toContain(a.status);
      expect([201, 202, 409, 422]).toContain(b.status);
      const pick = a.status === 409 || a.status === 422 ? b : a;
      const r = (await pick.json()) as Json;
      data = r.data ?? data;
      const row = (
        await q(
          "select state, next_chunk, chunk_count from plan_imports where id = ?",
          first.import_id,
        )
      )[0] as Json;
      data = { ...data, state: row.state };
      expect(row.next_chunk).toBeLessThanOrEqual(row.chunk_count);
    }
    expect(await planCounts(bid)).toEqual(expected);
    // A repeated continue after done answers the same 201.
    const again = await continueImportRest(first.import_id);
    expect(again.status).toBe(201);
    expect(((await again.json()) as Json).data).toMatchObject({ state: "done", budget_id: bid });
    expect(await planCounts(bid)).toEqual(expected);
  });

  it("a step repeated after it was applied writes nothing (the guard fails inside the batch)", async () => {
    const { data: first, bid } = await start();
    await continueImportRest(first.import_id);
    await continueImportRest(first.import_id);
    const row = (
      await q(
        "select r2_key, chunk_offsets, next_chunk from plan_imports where id = ?",
        first.import_id,
      )
    )[0] as Json;
    expect(row.next_chunk).toBe(2);
    const offsets = JSON.parse(row.chunk_offsets) as { offset: number; length: number }[];
    const obj = await env.FILES.get(row.r2_key, {
      range: offsets[0] as { offset: number; length: number },
    });
    const parts = JSON.parse(await (obj as R2ObjectBody).text());
    const before = await planCounts(bid);
    const db = getDb(env);
    for (const chunk of [0, 1]) {
      const stmts = insertRowsStmts(db, bid, parts, { importId: first.import_id, chunk });
      await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    }
    expect(await planCounts(bid)).toEqual(before);
    await runToDone(first);
  });
});

describe("case 8: the cron never touches a hidden plan", () => {
  it("a due schedule inside a half-written plan is not entered, and cancel removes it", async () => {
    const { data: first, bid } = await start();
    await continueImportRest(first.import_id);
    const account = (await q("select id from accounts where budget_id = ? limit 1", bid))[0]
      ?.id as string;
    expect(account).toBeTruthy();
    await env.DB.prepare(
      "insert into scheduled_transactions (id, budget_id, account_id, date_first, date_next, frequency, amount, inflow_to_ready_to_assign, write_token, created_at, updated_at) values ('zz-hidden-sched', ?, ?, '2026-01-01', '2026-01-01', 'never', -1000, 0, 'tok', '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z')",
    )
      .bind(bid, account)
      .run();
    const before = (await q("select count(*) n from transactions where budget_id = ?", bid))[0]?.n;
    const out = await enterDue(env, { budgetIds: "all", day: "2199-01-01", actor: "service:test" });
    expect(JSON.stringify(out)).not.toContain("zz-hidden-sched");
    expect((await q("select count(*) n from transactions where budget_id = ?", bid))[0]?.n).toBe(
      before,
    );
    expect(
      (await q("select date_next from scheduled_transactions where id = 'zz-hidden-sched'"))[0]
        ?.date_next,
    ).toBe("2026-01-01");
    expect(
      (await json(`/api/v1/budgets/import/${first.import_id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect(
      (await q("select count(*) n from scheduled_transactions where budget_id = ?", bid))[0]?.n,
    ).toBe(0);
  });
});

describe("case 9: cleanup", () => {
  const leftovers = async (bid: string) => {
    const out: Record<string, number> = {};
    for (const t of TABLES_OF_PLAN)
      out[t] = (await q(`select count(*) n from ${t} where budget_id = ?`, bid))[0]?.n;
    out.budgets = (await q("select count(*) n from budgets where id = ?", bid))[0]?.n;
    return out;
  };
  const gone = {
    accounts: 0,
    category_groups: 0,
    categories: 0,
    payees: 0,
    month_categories: 0,
    transactions: 0,
    scheduled_transactions: 0,
    change_log: 0,
    budgets: 0,
  };

  it("cancel mid-way removes every row and the stored file; continue is then 409", async () => {
    const visible = await buildF();
    const visibleBefore = await planCounts(visible.bid);
    const { data: first, bid } = await start();
    await continueImportRest(first.import_id);
    await continueImportRest(first.import_id);
    const written = await planCounts(bid);
    expect((written.accounts ?? 0) + (written.categories ?? 0)).toBeGreaterThan(0);
    expect((await r2Keys()).length).toBe(1);
    const res = await json(`/api/v1/budgets/import/${first.import_id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data).toEqual({
      import_id: first.import_id,
      state: "abandoned",
    });
    expect(await leftovers(bid)).toEqual(gone);
    expect(await r2Keys()).toEqual([]);
    const row = (
      await q(
        "select state, summary_json, chunk_offsets from plan_imports where id = ?",
        first.import_id,
      )
    )[0] as Json;
    expect(row).toMatchObject({ state: "abandoned", summary_json: "{}", chunk_offsets: "[]" });
    const next = await continueImportRest(first.import_id);
    expect(next.status).toBe(409);
    expect(((await next.json()) as Json).error.name).toBe("import_abandoned");
    // Another plan is untouched, and cancelling again is fine.
    expect(await planCounts(visible.bid)).toEqual(visibleBefore);
    expect(
      (await json(`/api/v1/budgets/import/${first.import_id}`, { method: "DELETE" })).status,
    ).toBe(200);
    // Through the tool.
    const second = await start();
    const t = await tool("cancel_budget_import", { import_id: second.data.import_id });
    expect(JSON.parse(t.result.content[0].text)).toEqual({
      import_id: second.data.import_id,
      state: "abandoned",
    });
    expect(await leftovers(second.bid)).toEqual(gone);
  });

  it("cancel of an unknown import is 404 and of a finished one 409, which keeps its plan", async () => {
    expect((await json("/api/v1/budgets/import/nope", { method: "DELETE" })).status).toBe(404);
    expect((await continueImportRest("nope")).status).toBe(404);
    const { data: first, bid } = await start();
    await runToDone(first);
    const res = await json(`/api/v1/budgets/import/${first.import_id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error.name).toBe("import_finished");
    expect((await json(`/api/v1/budgets/${bid}`)).status).toBe(200);
  });

  it("an import 25 hours stale is removed by the next POST", async () => {
    const { data: first, bid } = await start();
    await continueImportRest(first.import_id);
    const real = planClock.now;
    try {
      planClock.now = () => new Date("2026-11-17T13:00:00.000Z");
      importLimits.singleCallRows = 2500;
      const f = sampleFiles();
      const small = await postImport(
        importForm([
          { name: "S as of 2026-11-15 19-51 - Plan.csv", data: f.plan },
          { name: "S as of 2026-11-15 19-51 - Register.csv", data: f.register },
        ]),
      );
      expect(small.status).toBe(201);
    } finally {
      planClock.now = real;
      importLimits.singleCallRows = 0;
    }
    expect(await leftovers(bid)).toEqual(gone);
    expect(await r2Keys()).toEqual([]);
    expect(
      (await q("select state from plan_imports where id = ?", first.import_id))[0]?.state,
    ).toBe("abandoned");
  });

  it("a finished import whose file was left is cleaned by the next POST an hour later", async () => {
    const { data: first } = await start();
    await runToDone(first);
    await env.FILES.put(`plan-imports/${first.import_id}/chunks`, new Uint8Array([1, 2, 3]));
    await env.DB.prepare("update plan_imports set r2_key = ? where id = ?")
      .bind(`plan-imports/${first.import_id}/chunks`, first.import_id)
      .run();
    const real = planClock.now;
    try {
      planClock.now = () => new Date("2026-11-16T13:30:00.000Z");
      const z = await exportZip();
      importLimits.singleCallRows = 2500;
      expect((await postImport(importForm([{ name: z.name, data: z.data }]))).status).toBe(201);
    } finally {
      planClock.now = real;
      importLimits.singleCallRows = 0;
    }
    expect(await r2Keys()).toEqual([]);
    expect(
      (await q("select r2_key from plan_imports where id = ?", first.import_id))[0]?.r2_key,
    ).toBeNull();
  });

  it("an R2 object deleted mid-way: continue is 409 and the plan is cleaned", async () => {
    const { data: first, bid } = await start();
    await continueImportRest(first.import_id);
    await env.FILES.delete(`plan-imports/${first.import_id}/chunks`);
    const res = await continueImportRest(first.import_id);
    expect(res.status).toBe(409);
    expect(await leftovers(bid)).toEqual(gone);
    expect(
      (await q("select state from plan_imports where id = ?", first.import_id))[0]?.state,
    ).toBe("abandoned");
  });

  it("a step whose batch fails removes everything: 422 import_failed", async () => {
    const { data: first, bid } = await start();
    await continueImportRest(first.import_id);
    // Point chunk 1 at chunk 0's bytes: its ids exist already, so the batch fails on a primary key.
    const row = (
      await q("select chunk_offsets from plan_imports where id = ?", first.import_id)
    )[0] as Json;
    const offsets = JSON.parse(row.chunk_offsets);
    offsets[1] = offsets[0];
    await env.DB.prepare("update plan_imports set chunk_offsets = ? where id = ?")
      .bind(JSON.stringify(offsets), first.import_id)
      .run();
    const res = await continueImportRest(first.import_id);
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("import_failed");
    expect(await leftovers(bid)).toEqual(gone);
    expect(await r2Keys()).toEqual([]);
  });

  it("the stepped plans left nothing in total: every plan-owned row belongs to a visible plan", async () => {
    const orphans = await q(
      "select count(*) n from accounts a where not exists (select 1 from budgets b where b.id = a.budget_id and b.deleted_at is null) and not exists (select 1 from plan_imports i where i.budget_id = a.budget_id and i.state = 'writing')",
    );
    expect(orphans[0]?.n).toBe(0);
    void allCounts;
    void readZip;
  });
});

describe("case 8: a race on the last chunk answers the state as it is", () => {
  /** Everything but the last chunk written; the import row is returned. */
  async function atLastChunk() {
    const { data: first, bid } = await start();
    for (let i = 0; i < first.progress.chunk_count - 1; i++)
      await continueImportRest(first.import_id);
    return { first, bid };
  }

  it("the loser of two continues on the last chunk gets 201 done, not 409 import_abandoned", async () => {
    const { first, bid } = await atLastChunk();
    let raced = false;
    const FILES = new Proxy(env.FILES, {
      get(t, k) {
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k !== "get" || typeof v !== "function") {
          return typeof v === "function" ? v.bind(t) : v;
        }
        return async (...a: unknown[]) => {
          if (!raced) {
            raced = true;
            // The winner finishes (and deletes the stored file) between the loser's read of the row and its get.
            const won = await continueImport(env, first.import_id);
            expect(won.status).toBe(201);
          }
          return (v as (...x: unknown[]) => unknown).apply(t, a);
        };
      },
    });
    const res = await continueImportRest(first.import_id, { FILES } as unknown as Partial<Env>);
    expect(raced).toBe(true);
    const data = await body(res, 201);
    expect(data).toMatchObject({ state: "done", budget_id: bid });
    expect(await status(`/api/v1/budgets/${bid}`)).toBe(200);
    expect((await q("select count(*) n from change_log where budget_id = ?", bid))[0]?.n).toBe(1);
  });

  it("a cancel that loses to the last step answers 409 import_finished and keeps the plan", async () => {
    const { first, bid } = await atLastChunk();
    let raced = false;
    const DB = Object.create(env.DB) as D1Database;
    (DB as unknown as Record<string, unknown>).prepare = env.DB.prepare.bind(env.DB);
    (DB as unknown as Record<string, unknown>).batch = async (stmts: D1PreparedStatement[]) => {
      if (!raced) {
        raced = true;
        expect((await continueImport(env, first.import_id)).status).toBe(201);
      }
      return env.DB.batch(stmts);
    };
    const res = await call(
      `/api/v1/budgets/import/${first.import_id}`,
      await authed({ method: "DELETE" }),
      { DB } as unknown as Partial<Env>,
    );
    expect(raced).toBe(true);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Json).error.name).toBe("import_finished");
    expect(await status(`/api/v1/budgets/${bid}`)).toBe(200);
    expect(
      (await q("select state from plan_imports where id = ?", first.import_id))[0]?.state,
    ).toBe("done");
  });
});
