import { describe, expect, it } from "vitest";
import { continueImport, startImport } from "../src/services/plan-import";
import { actor, q } from "./bulk-helpers";
import { pinPlanClock } from "./plan-export-helpers";
import {
  allCounts,
  countingEnv,
  deflatedZip,
  planCounts,
  r2Keys,
  sampleFiles,
  sourceStyleLarge,
} from "./plan-import-helpers";

// EXF-477 case 10 (and the large dry run of case 6): D1 and R2 calls per invocation do not grow with the file.
pinPlanClock();
const MAX = 40;

describe("plan import: calls per invocation", () => {
  it("a small file completes in one invocation with at most 3 D1 calls", async () => {
    const f = sampleFiles();
    const c = countingEnv();
    const out = await startImport(c.env, actor, {
      files: [
        { name: "S as of 2026-11-15 19-51 - Plan.csv", bytes: new TextEncoder().encode(f.plan) },
        {
          name: "S as of 2026-11-15 19-51 - Register.csv",
          bytes: new TextEncoder().encode(f.register),
        },
      ],
      options: {},
      dryRun: false,
    });
    expect(out.status).toBe(201);
    expect(c.d1()).toBeLessThanOrEqual(3);
    expect(c.r2()).toBeLessThanOrEqual(1);
    console.log(`plan-import: sample, 1 invocation, ${c.d1()} D1 calls, ${c.r2()} R2 calls`);
    void deflatedZip;
  });

  it("a real plan's size: 20,000 transactions over 96 months, 200 categories, 30 accounts", async () => {
    const large = await sourceStyleLarge({
      accounts: 30,
      categories: 200,
      months: 96,
      transactions: 20_000,
    });
    console.log(
      `plan-import: generated zip ${large.bytes.length} bytes, ${large.expected.planRows} Plan rows, ${large.expected.registerRows} Register rows`,
    );
    const files = [{ name: large.name, bytes: large.bytes }];
    const c = countingEnv();
    const before = await allCounts();
    const keysBefore = await r2Keys();

    const t0 = performance.now();
    const dry = await startImport(c.env, actor, { files, options: {}, dryRun: true });
    const dryMs = Math.round(performance.now() - t0);
    expect(dry.status).toBe(200);
    expect(c.d1()).toBe(0);
    expect(c.r2()).toBe(0);
    expect(await allCounts()).toEqual(before);
    expect(await r2Keys()).toEqual(keysBefore);
    const preview = (dry as { preview: Record<string, unknown> }).preview as {
      counts: Record<string, number>;
      accounts: unknown[];
      mismatch_count: number;
      warning_count: number;
    };
    expect(preview.accounts).toHaveLength(30);
    expect(preview.counts).toMatchObject({
      accounts: 30,
      categories: 200,
      months: 96,
      splits: large.expected.splits,
      transfers_paired: large.expected.transfers,
    });
    expect(preview.mismatch_count, "the generated file is consistent").toBe(0);

    const times: { step: string; ms: number; d1: number; r2: number }[] = [];
    c.reset();
    const t1 = performance.now();
    const first = await startImport(c.env, actor, { files, options: {}, dryRun: false });
    times.push({ step: "start", ms: Math.round(performance.now() - t1), d1: c.d1(), r2: c.r2() });
    expect(first.status).toBe(202);
    const result = (
      first as {
        result: { import_id: string; progress: { chunk_count: number }; budget_id: string | null };
      }
    ).result;
    expect(result.budget_id).toBeNull();
    let state = "writing";
    let budgetId: string | null = null;
    let n = 0;
    while (state !== "done") {
      c.reset();
      const t = performance.now();
      const step = await continueImport(c.env, result.import_id);
      n++;
      times.push({
        step: `continue ${n}`,
        ms: Math.round(performance.now() - t),
        d1: c.d1(),
        r2: c.r2(),
      });
      state = step.result.state;
      budgetId = step.result.budget_id;
      expect(step.status).toBe(state === "done" ? 201 : 202);
    }
    const invocations = times.length;
    const slowest = times.reduce((a, b) => (b.ms > a.ms ? b : a));
    for (const t of times) {
      expect(t.d1, `${t.step} D1 calls`).toBeLessThanOrEqual(MAX);
      expect(t.r2, `${t.step} R2 calls`).toBeLessThanOrEqual(MAX);
    }
    const maxD1 = Math.max(...times.map((t) => t.d1));
    const maxR2 = Math.max(...times.map((t) => t.r2));
    console.log(
      `plan-import: ${invocations} invocations, slowest ${slowest.ms} ms (${slowest.step}), dry run ${dryMs} ms; max D1 ${maxD1}, max R2 ${maxR2}`,
    );

    // Counts checked in D1.
    const bid = budgetId as string;
    const counts = await planCounts(bid);
    expect(counts.accounts).toBe(30);
    expect(counts.categories).toBe(200);
    expect(counts.category_groups).toBe(preview.counts.groups);
    expect(counts.transactions).toBe(
      large.expected.registerRows -
        large.expected.splits * 2 +
        large.expected.splits * 3 -
        0 +
        0 -
        0,
    );
    expect(counts.month_categories).toBe(196 * 96);
    expect(counts.change_log).toBe(1);
    expect(
      (
        await q(
          "select count(*) n from transactions where budget_id = ? and parent_transaction_id is not null",
          bid,
        )
      )[0]?.n,
    ).toBe(large.expected.splits * 2);
    expect(
      (
        await q(
          "select count(*) n from transactions where budget_id = ? and transfer_transaction_id is not null",
          bid,
        )
      )[0]?.n,
    ).toBe(large.expected.transfers * 2);
    expect(await r2Keys()).toEqual(keysBefore);
  }, 300_000);
});
