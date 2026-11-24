import { env } from "cloudflare:test";
import { FileImportOptions } from "@budget/schema/file-import";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { changeLog } from "../src/db/schema/change-log";
import { buildImportBatch, prepareImport } from "../src/services/file-import";
import {
  account,
  actor,
  countLogs,
  fixture,
  importOk,
  importReq,
  type Json,
  plan,
  preview,
  previewReq,
  q,
  r2Keys,
  rowsCsv,
  TODAY,
} from "./file-import-helpers";
import { pinPlanClock } from "./plan-export-helpers";
import { countingEnv } from "./plan-import-helpers";

pinPlanClock();

const SIZES = [10, 100, 1000];

describe("file import: D1 calls and atomicity (AC12)", () => {
  it("preview and import cost the same D1 calls for 10, 100 and 1,000 rows (import <= 12)", async () => {
    const previews: number[] = [];
    const imports: number[] = [];
    for (const n of SIZES) {
      const bid = await plan();
      const aid = await account(bid);
      const c = countingEnv();
      const p = await preview(bid, aid, "r.csv", rowsCsv(n), { today: TODAY }, c.env);
      previews.push(c.d1());
      c.reset();
      expect(await importOk(bid, aid, p.file_id, {}, c.env)).toMatchObject({ imported: n });
      imports.push(c.d1());
    }
    console.log(`file import D1 calls: preview ${previews}, import ${imports}`);
    expect(new Set(previews).size).toBe(1);
    expect(new Set(imports).size).toBe(1);
    expect(imports[0]).toBeLessThanOrEqual(12);
  });

  it("the batch has the same number of statements for 100 and 1,000 rows", async () => {
    const lengths: number[] = [];
    for (const n of [100, 1000]) {
      const bid = await plan();
      const aid = await account(bid);
      const p = await preview(bid, aid, "r.csv", rowsCsv(n), { today: TODAY });
      const prepared = await prepareImport(env, actor, {
        budgetId: bid,
        accountId: aid,
        fileId: p.file_id,
        options: FileImportOptions.parse({ today: TODAY }),
      });
      lengths.push(buildImportBatch(getDb(env), prepared.plan).length);
    }
    console.log(`file import batch statements: 100 rows ${lengths[0]}, 1000 rows ${lengths[1]}`);
    expect(lengths[0]).toBe(lengths[1]);
  });

  it("2,001 rows give 422 too_many_rows and write nothing", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const before = (await q("select count(*) n from file_imports"))[0]?.n;
    const keys = (await r2Keys()).length;
    const logs = await countLogs(bid);
    const res = await previewReq(bid, aid, "r.csv", rowsCsv(2001), { today: TODAY });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("too_many_rows");
    expect((await q("select count(*) n from file_imports"))[0]?.n).toBe(before);
    expect((await r2Keys()).length).toBe(keys);
    expect(await countLogs(bid)).toBe(logs);
    expect((await q("select count(*) n from transactions where account_id = ?", aid))[0]?.n).toBe(
      1,
    );
  });

  it("a batch failing on its last statement writes nothing", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const p = await preview(bid, aid, "sample.csv", fixture("sample.csv"), { today: TODAY });
    const prepared = await prepareImport(env, actor, {
      budgetId: bid,
      accountId: aid,
      fileId: p.file_id,
      options: FileImportOptions.parse({ today: TODAY }),
    });
    const db = getDb(env);
    const snap = async () =>
      JSON.stringify([
        await q("select * from transactions where budget_id = ? order by id", bid),
        await q("select * from payees where budget_id = ? order by id", bid),
        await q("select * from change_log where budget_id = ? order by id", bid),
        await q("select * from account_import_settings where budget_id = ?", bid),
      ]);
    const before = await snap();
    const failing = db.insert(changeLog).values({
      id: crypto.randomUUID(),
      budgetId: bid,
      actor: null as never,
      action: "create",
      entityType: "x",
      entityId: "x",
      createdAt: "x",
    });
    const stmts = buildImportBatch(db, prepared.plan);
    expect(stmts.length).toBeGreaterThan(5);
    await expect(db.batch([...stmts, failing] as never)).rejects.toThrow(/NOT NULL|constraint/i);
    expect(await snap()).toBe(before);
    // and the batch alone does write
    await db.batch(stmts as never);
    expect(await snap()).not.toBe(before);
  });

  it("an import by file_id costs few D1 calls", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const c = countingEnv();
    const p = await preview(bid, aid, "sample.csv", fixture("sample.csv"), { today: TODAY });
    c.reset();
    await importReq(bid, aid, { file_id: p.file_id, options: { today: TODAY } }, c.env);
    console.log(`file import by id: ${c.d1()} D1 calls`);
    expect(c.d1()).toBeLessThanOrEqual(5);
  });
});
