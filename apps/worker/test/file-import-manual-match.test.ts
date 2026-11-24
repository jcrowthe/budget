import { describe, expect, it } from "vitest";
import {
  account,
  accountOn,
  fixture,
  importText,
  type Json,
  plan,
  q,
  rowsOf,
  send,
  tx,
} from "./file-import-helpers";
import { pinPlanClock } from "./plan-export-helpers";

pinPlanClock();

const tbase = (bid: string) => `/api/v1/budgets/${bid}/transactions`;

describe("a file row in Match and Unmatch (EXF-531, FI-3)", () => {
  async function fileWorld() {
    const bid = await plan();
    const aid = await account(bid);
    await importText(bid, aid, "sample.csv", fixture("sample.csv"));
    const file = (await rowsOf(aid)).find((r) => r.payee_name === "Sample Cafe") as Json;
    const hand = await tx(bid, {
      account_id: aid,
      date: "2026-11-10",
      amount: -450,
      payee_name: "ZZ-TEST Hand Cafe",
      memo: "hand memo",
    });
    return { bid, aid, file, hand };
  }

  const checkUnmatched = async (bid: string, aid: string, file: Json, handId: string) => {
    const rows = await rowsOf(aid);
    const hand = rows.find((r) => r.id === handId) as Json;
    expect(hand).toMatchObject({
      cleared: "uncleared",
      memo: "hand memo",
      import_id: null,
      import_memo: null,
    });
    const back = rows.find((r) => r.import_id === file.import_id) as Json;
    expect(back).toMatchObject({
      cleared: "cleared",
      approved: 0,
      source: "file",
      memo: "latte",
      import_memo: file.import_memo,
    });
    expect(back.id).not.toBe(handId);
  };

  it("AC1, AC2: match gives 200 with one row; unmatch brings the file row back", async () => {
    const { bid, aid, file, hand } = await fileWorld();
    const res = await send(`${tbase(bid)}/match`, "POST", { ids: [hand.id, file.id] });
    const body = (await res.json()) as Json;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.transaction).toMatchObject({ id: hand.id, matched: true });
    expect((await rowsOf(aid)).filter((r) => r.date === "2026-11-10")).toHaveLength(1);
    const [m] = await q("select * from transactions where id = ?", hand.id);
    expect(m).toMatchObject({ import_id: file.import_id, import_memo: "latte", source: null });

    const un = await send(`${tbase(bid)}/${hand.id}/unmatch`, "POST");
    expect(un.status).toBe(200);
    await checkUnmatched(bid, aid, file, hand.id);
  });

  it("AC3: an automatically matched file row unmatches the same way", async () => {
    const bid = await plan();
    const aid = await accountOn(bid, 530000);
    const hand = await tx(bid, {
      account_id: aid,
      date: "2026-11-15",
      amount: -20000,
      payee_name: "ZZ-TEST Corner Market",
      memo: "hand memo",
    });
    await importText(bid, aid, "three-rows.csv", fixture("three-rows.csv"));
    const [m] = await q("select * from transactions where id = ?", hand.id);
    expect(m.import_id).toMatch(/^file:v1:/);
    const un = await send(`${tbase(bid)}/${hand.id}/unmatch`, "POST");
    expect(un.status).toBe(200);
    const rows = await rowsOf(aid);
    expect(rows.find((r) => r.id === hand.id)).toMatchObject({
      cleared: "uncleared",
      memo: "hand memo",
      import_id: null,
    });
    expect(rows.find((r) => r.import_id === m.import_id)).toMatchObject({
      cleared: "cleared",
      approved: 0,
      source: "file",
      import_id: m.import_id,
    });
  });
});
