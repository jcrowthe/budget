import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { matchTransactions, unmatchTransaction } from "../src/services/manual-match";
import { getTransaction } from "../src/services/transactions";
import { sqlImport } from "./manual-match-helpers";
import { countingEnv, q, REST_ACTOR, setupPlaid, stubBank, world1 } from "./plaid-sync-helpers";
import { getImage, JPEG, objects, PNG, put } from "./transaction-images-helpers";

beforeEach(async () => {
  await setupPlaid();
  stubBank();
});

/** A hand entry and an unapproved bank import of one account, to match. */
async function pair() {
  const w = await world1();
  const entry = `zz-entry-${w.plan.slice(0, 8)}`;
  await q(
    "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_name) values (?, ?, ?, '2026-03-12', -12340, 'uncleared', 1, '2026-03-12T00:00:00.000Z', '2026-03-12T00:00:00.000Z', 'ZZ Cafe')",
    entry,
    w.plan,
    w.account,
  );
  const imp = await sqlImport(w.plan, w.account, { amount: -13000 });
  return { ...w, entry, imp: imp.id };
}

const bytes = async (plan: string, id: string) => {
  const res = await getImage(plan, id);
  return res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : res.status;
};
const hasImage = async (plan: string, id: string) =>
  (await getTransaction(env, plan, id)).has_image;
const liveImages = (plan: string) =>
  q(
    "select transaction_id from transaction_images where budget_id = ? and deleted_at is null order by transaction_id",
    plan,
  );

describe("a receipt image survives a manual match (EXF-593)", () => {
  it("only the import has one: it moves to the kept entry, no copy", async () => {
    const a = await pair();
    expect((await put(a.plan, a.imp, PNG)).status).toBe(200);
    const before = await objects(a.plan);
    await matchTransactions(env, REST_ACTOR, a.plan, [a.entry, a.imp]);
    expect(await hasImage(a.plan, a.entry)).toBe(true);
    expect(await bytes(a.plan, a.entry)).toEqual(PNG);
    expect(await liveImages(a.plan)).toEqual([{ transaction_id: a.entry }]);
    expect((await objects(a.plan)).map((o) => o.key)).toEqual(before.map((o) => o.key));
    const log = await q(
      "select action, before_json, after_json from change_log where budget_id = ? and entity_type = 'transaction_image' and action = 'update'",
      a.plan,
    );
    expect(log).toHaveLength(1);
  });

  it("only the entry has one: it stays", async () => {
    const a = await pair();
    await put(a.plan, a.entry, PNG);
    await matchTransactions(env, REST_ACTOR, a.plan, [a.entry, a.imp]);
    expect(await bytes(a.plan, a.entry)).toEqual(PNG);
  });

  it("both have one: the kept row keeps its own, the import's stays on the deleted row", async () => {
    const a = await pair();
    await put(a.plan, a.entry, PNG);
    await put(a.plan, a.imp, JPEG, "image/jpeg", "bank.jpg");
    await matchTransactions(env, REST_ACTOR, a.plan, [a.entry, a.imp]);
    expect(await bytes(a.plan, a.entry)).toEqual(PNG);
    expect(await liveImages(a.plan)).toEqual(
      [{ transaction_id: a.entry }, { transaction_id: a.imp }].sort((x, y) =>
        x.transaction_id < y.transaction_id ? -1 : 1,
      ),
    );
  });

  it("unmatch puts the moved image back on the bank's import row", async () => {
    const a = await pair();
    await put(a.plan, a.imp, JPEG, "image/jpeg", "bank.jpg");
    await matchTransactions(env, REST_ACTOR, a.plan, [a.entry, a.imp]);
    const { transaction, imported } = await unmatchTransaction(env, REST_ACTOR, a.plan, a.entry);
    expect(transaction.has_image).toBe(false);
    expect(imported.has_image).toBe(true);
    expect(await bytes(a.plan, imported.id)).toEqual(JPEG);
    expect(await bytes(a.plan, a.entry)).toBe(404);
  });

  it("unmatch with both: each side ends with its own image", async () => {
    const a = await pair();
    await put(a.plan, a.entry, PNG);
    await put(a.plan, a.imp, JPEG, "image/jpeg", "bank.jpg");
    await matchTransactions(env, REST_ACTOR, a.plan, [a.entry, a.imp]);
    const { imported } = await unmatchTransaction(env, REST_ACTOR, a.plan, a.entry);
    expect(await bytes(a.plan, a.entry)).toEqual(PNG);
    expect(await bytes(a.plan, imported.id)).toEqual(JPEG);
  });

  it("an image replaced after the match stays with the entry on unmatch", async () => {
    const a = await pair();
    await put(a.plan, a.imp, JPEG, "image/jpeg", "bank.jpg");
    await matchTransactions(env, REST_ACTOR, a.plan, [a.entry, a.imp]);
    await put(a.plan, a.entry, PNG);
    const { imported } = await unmatchTransaction(env, REST_ACTOR, a.plan, a.entry);
    expect(await bytes(a.plan, a.entry)).toEqual(PNG);
    expect(await bytes(a.plan, imported.id)).toBe(404);
  });

  it("match and unmatch make the same D1 calls with an image as without", async () => {
    const calls: number[][] = [];
    for (const withImage of [false, true]) {
      const a = await pair();
      if (withImage) await put(a.plan, a.imp, JPEG, "image/jpeg", "bank.jpg");
      const m = countingEnv();
      await matchTransactions(m.env, REST_ACTOR, a.plan, [a.entry, a.imp]);
      const u = countingEnv();
      await unmatchTransaction(u.env, REST_ACTOR, a.plan, a.entry);
      calls.push([m.calls.d1, u.calls.d1]);
    }
    expect(calls[1]).toEqual(calls[0]);
  });
});
