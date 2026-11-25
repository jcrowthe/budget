import { describe, expect, it } from "vitest";
import { tool } from "./bulk-helpers";
import {
  account,
  b64,
  importOk,
  type Json,
  plan,
  preview,
  rowsCsv,
  rowsOf,
  setSqlOf,
  TODAY,
  tx,
} from "./file-import-helpers";
import { pinPlanClock } from "./plan-export-helpers";
import { countingEnv } from "./plan-import-helpers";

pinPlanClock();

const outcomes = (p: Json) => p.rows.map((r: Json) => r.outcome);

describe("the preview marks what the import will do (EXF-988)", () => {
  it("a re-preview of an imported file marks every row; a partly-overlapping file only the overlap", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const first = await preview(bid, aid, "a.csv", rowsCsv(3), { today: TODAY });
    expect(outcomes(first)).toEqual(["new", "new", "new"]);
    await importOk(bid, aid, first.file_id);

    const again = await preview(bid, aid, "a.csv", rowsCsv(3), { today: TODAY });
    expect(outcomes(again)).toEqual(["already_imported", "already_imported", "already_imported"]);

    const partly = await preview(bid, aid, "b.csv", rowsCsv(5), { today: TODAY });
    expect(outcomes(partly)).toEqual([
      "already_imported",
      "already_imported",
      "already_imported",
      "new",
      "new",
    ]);
  });

  it("the marks equal the import's outcome, row by row", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const known = await preview(bid, aid, "k.csv", rowsCsv(1), { today: TODAY });
    await importOk(bid, aid, known.file_id);
    // rowsCsv(5): row 0 known; row 1 = 11/11 10.02; row 2 = 11/12 10.03; row 3 = 11/13 10.04; row 4 = 11/14 10.05
    const hand = await tx(bid, { account_id: aid, date: "2026-11-11", amount: -1000020 });
    const bank = await tx(bid, { account_id: aid, date: "2026-11-30", amount: -1000050 });
    await setSqlOf(bank.id, "source = 'plaid', import_id = 'plaid-ZZ-1'");
    const text = `${rowsCsv(5)}\n11/13/2026,ZZ-TEST Bank,,1000.05,`;
    const p = await preview(bid, aid, "m.csv", text, { today: TODAY });
    const marks = p.rows.map((r: Json) => r.outcome);
    expect(marks).toEqual(["already_imported", "matched", "new", "new", "new", "new"]);
    const before = new Set((await rowsOf(aid)).map((r) => r.import_id).filter(Boolean));
    const result = await importOk(bid, aid, p.file_id);
    const count = (m: string[]) => marks.filter((x: string) => m.includes(x)).length;
    expect(result).toEqual({
      imported: count(["new"]),
      matched: count(["matched", "already_imported"]),
      skipped: count(["bank_duplicate"]),
    });
    const after = await rowsOf(aid);
    for (const r of p.rows as Json[]) {
      const hit = after.find((x) => x.import_id === r.key);
      if (r.outcome === "already_imported") expect(before.has(r.key)).toBe(true);
      else if (r.outcome === "matched") expect(hit?.id).toBe(hand.id);
      else if (r.outcome === "new") expect(hit?.source).toBe("file");
    }
  });

  it("marks a row equal to a bank-synced row", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const t = await tx(bid, { account_id: aid, date: "2026-11-10", amount: -12340 });
    await setSqlOf(t.id, "source = 'plaid', import_id = 'plaid-ZZ-1'");
    const p = await preview(
      bid,
      aid,
      "a.csv",
      "Date,Payee,Memo,Outflow,Inflow\n11/10/2026,ZZ,,12.34,",
      {
        today: TODAY,
      },
    );
    expect(outcomes(p)).toEqual(["bank_duplicate"]);
    expect(await importOk(bid, aid, p.file_id)).toEqual({ imported: 0, matched: 0, skipped: 1 });
  });

  it("costs the same D1 calls for 10 and 100 rows, with and without known rows", async () => {
    const calls: number[] = [];
    for (const n of [10, 100]) {
      const bid = await plan();
      const aid = await account(bid);
      const p0 = await preview(bid, aid, "r.csv", rowsCsv(n), { today: TODAY });
      await importOk(bid, aid, p0.file_id);
      const c = countingEnv();
      const p = await preview(bid, aid, "r.csv", rowsCsv(n), { today: TODAY }, c.env);
      expect(p.rows.every((r: Json) => r.outcome === "already_imported")).toBe(true);
      calls.push(c.d1());
    }
    expect(calls[0]).toBe(calls[1]);
  });

  it("the MCP preview carries the same marks as REST", async () => {
    const [b1, b2] = [await plan(), await plan()];
    const [a1, a2] = [await account(b1), await account(b2)];
    for (const [b, a] of [
      [b1, a1],
      [b2, a2],
    ] as const) {
      const p = await preview(b, a, "a.csv", rowsCsv(2), { today: TODAY });
      await importOk(b, a, p.file_id);
    }
    const rest = await preview(b1, a1, "a.csv", rowsCsv(3), { today: TODAY });
    const r = await tool("preview_transactions_file", {
      budget_id: b2,
      account_id: a2,
      file_name: "a.csv",
      content_base64: b64(rowsCsv(3)),
      options: { today: TODAY },
    });
    expect(r.result.isError).not.toBe(true);
    expect(outcomes(r.result.structuredContent)).toEqual(outcomes(rest));
    expect(outcomes(rest)).toEqual(["already_imported", "already_imported", "new"]);
  });
});
