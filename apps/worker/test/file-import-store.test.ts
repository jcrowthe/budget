import { describe, expect, it } from "vitest";
import {
  account,
  fixture,
  importReq,
  type Json,
  plan,
  preview,
  q,
  r2Keys,
  TODAY,
} from "./file-import-helpers";
import { pinPlanClock } from "./plan-export-helpers";

pinPlanClock();

describe("file import: R2 store and sweep (AC15)", () => {
  it("stores one object per preview, 410 after 30 days, and the next preview sweeps it", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const p = await preview(bid, aid, "sample.csv", fixture("sample.csv"), { today: TODAY });
    expect(await r2Keys(`file-imports/${bid}/`)).toEqual([`file-imports/${bid}/${p.file_id}`]);

    await q(
      "update file_imports set created_at = '2026-10-01T00:00:00.000Z', expires_at = '2026-10-31T00:00:00.000Z' where id = ?",
      p.file_id,
    );
    const body = { file_id: p.file_id, options: { today: TODAY } };
    const res = await importReq(bid, aid, body);
    expect(res.status).toBe(410);
    expect(((await res.json()) as Json).error.name).toBe("file_expired");

    await preview(bid, aid, "sample.csv", fixture("sample.csv"), { today: TODAY });
    const [row] = await q("select deleted_at from file_imports where id = ?", p.file_id);
    expect(row.deleted_at).not.toBeNull();
    expect(await r2Keys(`file-imports/${bid}/${p.file_id}`)).toEqual([]);
    expect((await importReq(bid, aid, body)).status).toBe(410);
  });

  it("sweeps at most 5 per call", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++)
      ids.push(
        (await preview(bid, aid, "sample.csv", fixture("sample.csv"), { today: TODAY })).file_id,
      );
    for (const id of ids)
      await q(
        "update file_imports set created_at = '2026-10-01T00:00:00.000Z', expires_at = '2026-10-31T00:00:00.000Z' where id = ?",
        id,
      );
    await preview(bid, aid, "sample.csv", fixture("sample.csv"), { today: TODAY });
    const swept = await q(
      `select count(*) n from file_imports where budget_id = ? and deleted_at is not null`,
      bid,
    );
    expect(swept[0].n).toBe(5);
    expect((await r2Keys(`file-imports/${bid}/`)).length).toBe(3);
  });

  it("a file_id of another account is 404", async () => {
    const bid = await plan();
    const a = await account(bid);
    const b = await account(bid);
    const p = await preview(bid, a, "sample.csv", fixture("sample.csv"), { today: TODAY });
    const res = await importReq(bid, b, { file_id: p.file_id, options: { today: TODAY } });
    expect(res.status).toBe(404);
  });
});
