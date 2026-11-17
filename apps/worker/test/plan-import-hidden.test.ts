import { env } from "cloudflare:test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syncDueConnections } from "../src/services/plaid-sync";
import { planClock } from "../src/services/plan-clock";
import { importLimits } from "../src/services/plan-import";
import { type Json, q, tool } from "./bulk-helpers";
import { json } from "./helpers";
import { plaidTxn } from "./plaid-stub";
import {
  count,
  feed,
  imports,
  setupPlaid,
  q as sq,
  stubBank,
  syncOne,
  world1,
} from "./plaid-sync-helpers";
import { buildF, NOW, pinPlanClock } from "./plan-export-helpers";
import {
  body,
  continueImportRest,
  importForm,
  postImport,
  r2Keys,
  runToDone,
  sampleFiles,
  TABLES_OF_PLAN,
} from "./plan-import-helpers";

// EXF-477, carry-over points 3: a half-written plan is invisible to the bank sync and to plan-scoped tools, and
// cancel and the sweep tell an importing plan from a plan the owner deleted.
pinPlanClock();

const saved = { ...importLimits };
beforeAll(() => {
  importLimits.chunkRows = 7;
  importLimits.singleCallRows = 0;
});
afterAll(() => Object.assign(importLimits, saved));
beforeEach(setupPlaid);

async function exportZip() {
  const f = await buildF();
  const res = await json(`/api/v1/budgets/${f.bid}/export?now=${encodeURIComponent(NOW)}`);
  const name = /filename="([^"]+)"/.exec(
    res.headers.get("Content-Disposition") ?? "",
  )?.[1] as string;
  return { name, data: new Uint8Array(await res.arrayBuffer()), f };
}
async function start() {
  const z = await exportZip();
  const data = await body(await postImport(importForm([{ name: z.name, data: z.data }])), 202);
  const bid = (await q("select budget_id from plan_imports where id = ?", data.import_id))[0]
    ?.budget_id as string;
  return { data, bid, z };
}

/** Every row of the plan in every plan table, and its own `budgets` row, as text. */
async function snapshot(bid: string) {
  const out: Record<string, string> = {};
  for (const t of TABLES_OF_PLAN) {
    out[t] = JSON.stringify(await q(`select * from ${t} where budget_id = ? order by rowid`, bid));
  }
  out.budgets = JSON.stringify(await q("select * from budgets where id = ?", bid));
  return out;
}

describe("a half-written plan and the bank sync", () => {
  it("the sync writes into the visible plan only; the hidden plan is untouched; cancel leaves nothing", async () => {
    stubBank();
    const w = await world1();
    const { data: first, bid } = await start();
    await continueImportRest(first.import_id);
    const hiddenAccount = (
      await sq("select id from accounts where budget_id = ? order by id limit 1", bid)
    )[0]?.id as string;
    expect(hiddenAccount).toBeTruthy();
    // The hidden plan's account is linked to the connection's other bank account, so a sync that did not
    // skip it would write its row there.
    await env.DB.prepare("update accounts set bank_account_id = ? where id = ?")
      .bind(w.bank["ZZ Savings"], hiddenAccount)
      .run();
    feed.pages = [
      {
        added: [
          plaidTxn({ transaction_id: "ZZ-HID-1", account_id: "acc-chk", amount: 5 }),
          plaidTxn({ transaction_id: "ZZ-HID-2", account_id: "acc-sav", amount: 6 }),
        ],
      },
    ];
    const hiddenBefore = await snapshot(bid);
    const txBefore = await count("select count(*) n from transactions where budget_id = ?", bid);

    const out = await syncOne(w.plan, w.conn);
    expect(out.added).toBeGreaterThanOrEqual(1);
    expect((await imports(w.account)).length).toBe(1);
    await syncDueConnections(env);

    expect(await snapshot(bid)).toEqual(hiddenBefore);
    expect(await count("select count(*) n from transactions where budget_id = ?", bid)).toBe(
      txBefore,
    );
    expect(
      await count(
        "select count(*) n from transactions where budget_id = ? and source = 'plaid'",
        bid,
      ),
    ).toBe(0);
    expect(await count("select count(*) n from change_log where budget_id = ?", bid)).toBe(0);

    expect(
      (await json(`/api/v1/budgets/import/${first.import_id}`, { method: "DELETE" })).status,
    ).toBe(200);
    for (const t of TABLES_OF_PLAN) {
      expect(await count(`select count(*) n from ${t} where budget_id = ?`, bid)).toBe(0);
    }
    expect(await count("select count(*) n from budgets where id = ?", bid)).toBe(0);
    expect(await r2Keys()).toEqual([]);
    // The visible plan's row stayed.
    expect((await imports(w.account)).length).toBe(1);
  });
});

describe("plan-scoped tools on a half-written plan", () => {
  it("accounts and month tools answer as if the plan were absent, and work after the last step", async () => {
    const { data: first, bid } = await start();
    await continueImportRest(first.import_id);
    for (const [name, args] of [
      ["list_accounts", { budget_id: bid }],
      ["get_month_summary", { budget_id: bid, month: "2026-10-01" }],
    ] as const) {
      const r = await tool(name, args);
      expect(r.result.isError, name).toBe(true);
    }
    expect((await json(`/api/v1/budgets/${bid}/accounts`)).status).toBe(404);
    await runToDone(first);
    const ok = await tool("list_accounts", { budget_id: bid });
    expect(ok.result.isError).toBeFalsy();
  });
});

describe("a plan the owner deleted is not an importing plan", () => {
  it("survives cancel and the sweep: every row stays, its R2 key is cleared", async () => {
    // (i) an ordinary plan, deleted by the owner.
    const one = await buildF();
    expect((await json(`/api/v1/budgets/${one.bid}`, { method: "DELETE" })).status).toBe(200);
    const snapOne = await snapshot(one.bid);
    expect(JSON.parse(snapOne.budgets as string)[0].deleted_at).not.toBeNull();
    expect(JSON.parse(snapOne.transactions as string).length).toBeGreaterThan(0);

    // (ii) an import run to done, then its plan deleted.
    const { data: second, bid: bidTwo } = await start();
    await runToDone(second);
    expect((await json(`/api/v1/budgets/${bidTwo}`, { method: "DELETE" })).status).toBe(200);
    const snapTwo = await snapshot(bidTwo);
    expect(JSON.parse(snapTwo.budgets as string)[0].deleted_at).not.toBeNull();
    expect(JSON.parse(snapTwo.transactions as string).length).toBeGreaterThan(0);

    // (iii) an import left writing.
    const { data: third, bid: bidThree } = await start();
    await continueImportRest(third.import_id);

    const cancelThree = await json(`/api/v1/budgets/import/${third.import_id}`, {
      method: "DELETE",
    });
    expect(cancelThree.status).toBe(200);
    expect(await count("select count(*) n from budgets where id = ?", bidThree)).toBe(0);
    for (const t of TABLES_OF_PLAN) {
      expect(await count(`select count(*) n from ${t} where budget_id = ?`, bidThree)).toBe(0);
    }
    const cancelTwo = await json(`/api/v1/budgets/import/${second.import_id}`, {
      method: "DELETE",
    });
    expect(cancelTwo.status).toBe(409);
    expect(((await cancelTwo.json()) as Json).error.name).toBe("import_finished");

    // The sweep, 25 hours later; a dummy key on (ii) gives it something to clear.
    await env.DB.prepare("update plan_imports set r2_key = ? where id = ?")
      .bind("plan-imports/dummy/chunks", second.import_id)
      .run();
    const real = planClock.now;
    const keep = importLimits.singleCallRows;
    try {
      planClock.now = () => new Date("2026-11-17T13:00:00.000Z");
      importLimits.singleCallRows = 2500;
      const f = sampleFiles();
      for (let i = 0; i < 2; i++) {
        const res = await postImport(
          importForm([
            { name: "S as of 2026-11-15 19-51 - Plan.csv", data: f.plan },
            { name: "S as of 2026-11-15 19-51 - Register.csv", data: f.register },
          ]),
        );
        expect(res.status).toBe(201);
      }
    } finally {
      planClock.now = real;
      importLimits.singleCallRows = keep;
    }
    expect(await snapshot(one.bid)).toEqual(snapOne);
    expect(await snapshot(bidTwo)).toEqual(snapTwo);
    expect(await count("select count(*) n from budgets where id in (?, ?)", one.bid, bidTwo)).toBe(
      2,
    );
    expect(
      (await q("select r2_key from plan_imports where id = ?", second.import_id))[0]?.r2_key,
    ).toBeNull();
    expect(await r2Keys()).toEqual([]);
  });
});
