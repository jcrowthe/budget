import { createHash } from "node:crypto";
import { buildFileRows, FileImportOptions } from "@budget/schema/file-import";
import { readFileText } from "@budget/schema/file-import-read";
import { describe, expect, it } from "vitest";
import {
  account,
  fixture,
  type Json,
  plan,
  preview,
  previewReq,
  q,
  TODAY,
} from "./file-import-helpers";

const sha = async (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

describe("file import preview (EXF-531, AC1)", () => {
  it("sample.csv previews with format, labels, mapping, remember and the rows buildFileRows gives", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const p = await preview(bid, aid, "sample.csv", fixture("sample.csv"), { today: TODAY });
    expect(p.format).toBe("csv");
    expect(p.labels).toEqual(["Date", "Payee", "Memo", "Outflow", "Inflow"]);
    expect(p.mapping).toEqual({ date: 0, payee: 1, memo: 2, outflow: 3, inflow: 4 });
    expect(p.options.remember).toBe(true);
    expect(p.rows).toHaveLength(2);
    expect(typeof p.file_id).toBe("string");
    expect(typeof p.expires_at).toBe("string");

    const opts = FileImportOptions.parse({ today: TODAY });
    const [{ date_format: planFormat }] = (await q(
      "select date_format from budgets where id = ?",
      bid,
    )) as Json[];
    const built = await buildFileRows(
      readFileText("sample.csv", fixture("sample.csv")),
      opts,
      {
        today: TODAY,
        cutoff: { start: "2026-11-10", reconciled: null, importStart: null },
        accountId: aid,
        planFormat,
      },
      sha,
    );
    // The Worker adds the outcome of each row (EXF-988); everything else is what buildFileRows gives.
    expect(p.rows).toEqual(built.rows.map((r) => ({ ...r, outcome: "new" })));
    expect(p.row_count).toBe(2);
  });

  it("answers 404 for an unknown account and 422 for an unsupported format", async () => {
    const bid = await plan();
    const aid = await account(bid);
    expect((await previewReq(bid, crypto.randomUUID(), "a.csv", "x")).status).toBe(404);
    const res = await previewReq(bid, aid, "a.pdf", "x");
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("unsupported_format");
  });

  it("answers 413 file_too_large over 2,000,000 bytes", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const res = await previewReq(bid, aid, "big.csv", new Uint8Array(2_000_001));
    expect(res.status).toBe(413);
    expect(((await res.json()) as Json).error.name).toBe("file_too_large");
  });
});
