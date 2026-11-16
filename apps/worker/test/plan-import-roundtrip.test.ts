import { env } from "cloudflare:test";
import { afterAll, describe, expect, it } from "vitest";
import { importLimits } from "../src/services/plan-import";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { buildF, NOW, pinPlanClock, readZip, text } from "./plan-export-helpers";
import { body, importForm, postImport, runToDone } from "./plan-import-helpers";

// EXF-477 criterion 7 (the main test): a plan built in a test, exported by the clone, imported, exported again:
// the Plan and Register rows are identical. Also criterion 5: the recomputed figures equal the file's.
pinPlanClock();

async function exportOf(bid: string) {
  const res = await json(`/api/v1/budgets/${bid}/export?now=${encodeURIComponent(NOW)}`);
  expect(res.status).toBe(200);
  const name = /filename="([^"]+)"/.exec(
    res.headers.get("Content-Disposition") ?? "",
  )?.[1] as string;
  return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
}

const original = { chunk: importLimits.chunkRows };
afterAll(() => {
  importLimits.chunkRows = original.chunk;
});

describe("criterion 7: export, import, export", () => {
  it("gives identical Plan and Register files (single call)", async () => {
    const f = await buildF();
    const first = await exportOf(f.bid);
    const res = await postImport(importForm([{ name: first.name, data: first.bytes }]));
    const data = await body(res, 201);
    expect(data.state).toBe("done");
    const second = await exportOf(data.budget_id);
    const a = readZip(first.bytes);
    const b = readZip(second.bytes);
    expect(b.map((e) => e.name)).toEqual(a.map((e) => e.name));
    expect(text(b[0]?.data as Uint8Array)).toBe(text(a[0]?.data as Uint8Array));
    expect(text(b[1]?.data as Uint8Array)).toBe(text(a[1]?.data as Uint8Array));
    expect(data.summary.warning_count).toBeGreaterThanOrEqual(0);
  });

  it("gives identical files through the stepped path (chunkRows 7)", async () => {
    importLimits.chunkRows = 7;
    const small = importLimits.singleCallRows;
    importLimits.singleCallRows = 0;
    try {
      const f = await buildF();
      const first = await exportOf(f.bid);
      const res = await postImport(importForm([{ name: first.name, data: first.bytes }]));
      const start = await body(res, 202);
      expect(start.state).toBe("writing");
      expect(start.budget_id).toBeNull();
      expect(start.progress.chunk_count).toBeGreaterThan(3);
      const { data } = await runToDone(start);
      const second = await exportOf(data.budget_id);
      const a = readZip(first.bytes);
      const b = readZip(second.bytes);
      expect(text(b[0]?.data as Uint8Array)).toBe(text(a[0]?.data as Uint8Array));
      expect(text(b[1]?.data as Uint8Array)).toBe(text(a[1]?.data as Uint8Array));
    } finally {
      importLimits.singleCallRows = small;
    }
  });
});

describe("criterion 5: the recomputed Activity and Available", () => {
  it("F exported then imported has no mismatch, and the figures equal the new plan's months", async () => {
    const f = await buildF();
    const first = await exportOf(f.bid);
    const data = await body(
      await postImport(importForm([{ name: first.name, data: first.bytes }])),
      201,
    );
    expect(data.summary.mismatch_count).toBe(0);
    expect(data.summary.mismatches).toEqual([]);
    const plan = text(readZip(first.bytes)[0]?.data as Uint8Array);
    expect(plan).toContain(
      '"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$0.00,-$70.00,$130.00',
    );
    const oct = (
      (await (await json(`/api/v1/budgets/${data.budget_id}/months/2026-10-01`)).json()) as Json
    ).data;
    const groceries = oct.groups
      .flatMap((g: Json) => g.categories)
      .find((c: Json) => c.name === "Groceries 🛒");
    expect([groceries.activity, groceries.available]).toEqual([-70000, 130000]);
  });

  it("one edited Activity cell is exactly that mismatch", async () => {
    const f = await buildF();
    const first = await exportOf(f.bid);
    const [planEntry, regEntry] = readZip(first.bytes);
    const planText = text(planEntry?.data as Uint8Array);
    const edited = planText.replace(
      '"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$0.00,-$70.00,$130.00',
      '"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$0.00,-$71.00,$130.00',
    );
    expect(edited).not.toBe(planText);
    const data = await body(
      await postImport(
        importForm([
          { name: planEntry?.name as string, data: edited },
          { name: regEntry?.name as string, data: regEntry?.data as Uint8Array },
        ]),
      ),
      201,
    );
    expect(data.summary.mismatch_count).toBe(1);
    expect(data.summary.mismatches).toEqual([
      {
        category: "Everyday: Groceries 🛒",
        month: "2026-10-01",
        column: "activity",
        expected: -71000,
        got: -70000,
      },
    ]);
    void env;
    void q;
  });
});
