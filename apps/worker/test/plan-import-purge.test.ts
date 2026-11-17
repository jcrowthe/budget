import { env } from "cloudflare:test";
import { afterAll, describe, expect, it } from "vitest";
import { importLimits } from "../src/services/plan-import";
import { type Json, q } from "./bulk-helpers";
import { PINNED, pinPlanClock } from "./plan-export-helpers";
import {
  body,
  continueImportRest,
  importForm,
  postImport,
  SAMPLE_ZIP_NAME,
  sampleZip,
} from "./plan-import-helpers";

// The rows of finished or abandoned imports hold no file: a start removes those older than 24 hours.
pinPlanClock();
const saved = { ...importLimits };
afterAll(() => Object.assign(importLimits, saved));

const hoursBefore = (h: number) => new Date(Date.parse(PINNED) - h * 3600_000).toISOString();

async function row(state: string, hours: number, r2Key: string | null = null) {
  const id = crypto.randomUUID();
  const at = hoursBefore(hours);
  await env.DB.prepare(
    "insert into plan_imports (id, budget_id, state, actor, file_name, r2_key, chunk_count, next_chunk, chunk_offsets, summary_json, created_at, updated_at, finished_at) values (?, ?, ?, 'user:tester@localhost', 'f.csv', ?, 1, 1, '[]', '{}', ?, ?, ?)",
  )
    .bind(id, crypto.randomUUID(), state, r2Key, at, at, state === "writing" ? null : at)
    .run();
  return id;
}
const exists = async (id: string) =>
  ((await q("select count(*) n from plan_imports where id = ?", id)) as Json[])[0]?.n === 1;

describe.each([
  ["single call", 202 - 1, () => undefined],
  ["stepped", 202, () => Object.assign(importLimits, { chunkRows: 7, singleCallRows: 0 })],
])("a start (%s)", (_n, status, setup) => {
  it("removes ended imports older than 24 hours and nothing else", async () => {
    setup();
    const a = await row("done", 25);
    const b = await row("abandoned", 25);
    const c = await row("done", 23);
    const d = await row("writing", 1);
    const e = await row("done", 25, "imports/kept/chunks");
    const res = await postImport(importForm([{ name: SAMPLE_ZIP_NAME, data: await sampleZip() }]));
    const data = await body(res, status === 202 ? 202 : 201);
    expect(await exists(a)).toBe(false);
    expect(await exists(b)).toBe(false);
    expect(await exists(c)).toBe(true);
    expect(await exists(d)).toBe(true);
    // The sweep, which runs first, clears the kept file of one such import; its row then holds none and goes.
    expect(await exists(e)).toBe(false);
    expect(await exists(data.import_id)).toBe(true);
    expect((await continueImportRest(a)).status).toBe(404);
    Object.assign(importLimits, saved);
  });
});
