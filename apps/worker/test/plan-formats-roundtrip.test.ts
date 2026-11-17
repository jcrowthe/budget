import { afterAll, describe, expect, it } from "vitest";
import { importLimits } from "../src/services/plan-import";
import type { Json } from "./bulk-helpers";
import { json } from "./helpers";
import { buildF, NOW, pinPlanClock, readZip, text } from "./plan-export-helpers";
import { body, importForm, postImport, runToDone } from "./plan-import-helpers";

// EXF-468: a plan in Euro, 123.456,78, After amount, DD.MM.YYYY is exported, imported, and the new plan has the
// same formats and the same amounts.
pinPlanClock();

const original = { chunk: importLimits.chunkRows };
afterAll(() => {
  importLimits.chunkRows = original.chunk;
});

async function exportOf(bid: string) {
  const res = await json(`/api/v1/budgets/${bid}/export?now=${encodeURIComponent(NOW)}`);
  expect(res.status).toBe(200);
  const name = /filename="([^"]+)"/.exec(
    res.headers.get("Content-Disposition") ?? "",
  )?.[1] as string;
  return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
}
const read = async (id: string): Promise<Json> =>
  ((await (await json(`/api/v1/budgets/${id}`)).json()) as Json).data.budget;
const month = async (id: string, m: string): Promise<Json> =>
  ((await (await json(`/api/v1/budgets/${id}/months/${m}`)).json()) as Json).data;
const figures = (m: Json) =>
  m.groups
    .flatMap((g: Json) =>
      g.categories.map((c: Json) => [c.name, c.assigned, c.activity, c.available]),
    )
    .sort((x: Json, y: Json) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

async function roundTrip(patch: Json) {
  const f = await buildF();
  const res = await json(`/api/v1/budgets/${f.bid}`, { method: "PATCH" }, patch);
  expect(res.status).toBe(200);
  const first = await exportOf(f.bid);
  const imported = await body(
    await postImport(importForm([{ name: first.name, data: first.bytes }])),
    201,
  );
  expect(imported.state).toBe("done");
  return { f, first, id: imported.budget_id as string };
}

describe("plan formats: export, import", () => {
  it("EUR, 123.456,78, after, DD.MM.YYYY comes back as it was, with the same amounts", async () => {
    const { f, first, id } = await roundTrip({
      currency_format: { iso_code: "EUR", example_format: "123.456,78", symbol_placement: "after" },
      date_format: { format: "DD.MM.YYYY" },
    });
    const a = await read(f.bid);
    const b = await read(id);
    expect(b.currency_format).toEqual(a.currency_format);
    expect(b.date_format).toEqual(a.date_format);
    const files = readZip(first.bytes);
    expect(text(files[1]?.data as Uint8Array)).toMatch(/"\d\d\.\d\d\.\d{4}"/);
    for (const m of ["2026-10-01", "2026-11-01", "2026-12-01"]) {
      expect(figures(await month(id, m))).toEqual(figures(await month(f.bid, m)));
    }
    const second = await exportOf(id);
    const s = readZip(second.bytes);
    expect(text(s[0]?.data as Uint8Array)).toBe(text(files[0]?.data as Uint8Array));
    expect(text(s[1]?.data as Uint8Array)).toBe(text(files[1]?.data as Uint8Array));
  });

  it("KWD (three decimals) keeps its amounts", async () => {
    const { f, id } = await roundTrip({
      currency_format: { iso_code: "KWD", symbol_placement: "none" },
    });
    // With no symbol in the file the currency is not known: the first one with three decimals (a known limit).
    const b = await read(id);
    expect(b.currency_format.decimal_digits).toBe(3);
    expect(b.currency_format.example_format).toBe("123,456.789");
    expect(b.currency_format.display_symbol).toBe(false);
    for (const m of ["2026-10-01", "2026-11-01"]) {
      expect(figures(await month(id, m))).toEqual(figures(await month(f.bid, m)));
    }
  });

  it("the stepped path stores the formats too", async () => {
    importLimits.chunkRows = 7;
    const small = importLimits.singleCallRows;
    importLimits.singleCallRows = 0;
    try {
      const f = await buildF();
      await json(
        `/api/v1/budgets/${f.bid}`,
        { method: "PATCH" },
        { currency_format: { iso_code: "JPY" }, date_format: { format: "YYYY-MM-DD" } },
      );
      const first = await exportOf(f.bid);
      const start = await body(
        await postImport(importForm([{ name: first.name, data: first.bytes }])),
        202,
      );
      const { data } = await runToDone(start);
      const b = await read(data.budget_id);
      expect(b.currency_format).toMatchObject({ iso_code: "JPY", decimal_digits: 0 });
      expect(b.date_format.format).toBe("YYYY-MM-DD");
    } finally {
      importLimits.singleCallRows = small;
    }
  });
});
