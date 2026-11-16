import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import * as txRepo from "../src/repositories/transactions";
import { bulkTransactions } from "../src/services/transactions-bulk";
import {
  account,
  actor,
  bulk,
  bulkOk,
  category,
  DAY,
  get,
  type Json,
  logs,
  plan,
  send,
  setSql,
  tx,
} from "./bulk-helpers";

/** The request is refused with this status and code, names the id, and writes nothing. */
async function refused(b: string, body: Json, status: number, code: string, id: string) {
  const before = await logs(b);
  const res = await bulk(b, body);
  const err = ((await res.json()) as Json).error;
  expect(res.status).toBe(status);
  expect(err.name).toBe(code);
  expect(err.detail.startsWith(`Transaction ${id}: `)).toBe(true);
  expect(await logs(b)).toBe(before);
  return err.detail as string;
}

describe("refusals change nothing", () => {
  it("an unknown id is a 404 naming it, and the known rows keep their state", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await tx(b, { account_id: a, date: DAY, amount: -1 });
    await refused(b, { op: "clear", ids: [r.id, "nope"] }, 404, "not_found", "nope");
    expect((await get(b, r.id)).cleared).toBe("uncleared");
  });

  it("move: a closed target, an unknown target, a transfer into its other account, both sides", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const closed = await account(b, "checking", 0);
    expect((await send(`/api/v1/budgets/${b}/accounts/${closed}/close`, "POST")).status).toBe(200);
    const r = await tx(b, { account_id: a1, date: DAY, amount: -100 });
    const t = await tx(b, { account_id: a1, date: DAY, amount: -1000, transfer_account_id: a2 });
    await refused(b, { op: "move", ids: [r.id], value: closed }, 422, "account_closed", r.id);
    await refused(
      b,
      { op: "move", ids: [r.id], value: crypto.randomUUID() },
      422,
      "unprocessable_entity",
      r.id,
    );
    await refused(b, { op: "move", ids: [t.id], value: a2 }, 422, "unprocessable_entity", t.id);
    const both = await account(b);
    await refused(
      b,
      { op: "move", ids: [t.id, t.transfer_transaction_id], value: both },
      422,
      "unprocessable_entity",
      t.id,
    );
    expect((await get(b, r.id)).account_id).toBe(a1);
  });

  it("move: a categorized row to a tracking account is refused readably", async () => {
    const b = await plan();
    const a1 = await account(b);
    const asset = await account(b, "otherAsset", 0);
    const cat = await category(b);
    const r = await tx(b, { account_id: a1, date: DAY, amount: -100, category_id: cat });
    const detail = await refused(
      b,
      { op: "move", ids: [r.id], value: asset },
      422,
      "unprocessable_entity",
      r.id,
    );
    expect(detail).toContain("is a tracking account: its transactions take no category");
  });

  it("categorize: an unknown category is refused", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await tx(b, { account_id: a, date: DAY, amount: -1 });
    await refused(
      b,
      { op: "categorize", ids: [r.id], value: crypto.randomUUID() },
      422,
      "unprocessable_entity",
      r.id,
    );
  });

  it("duplicate: a closed account is refused", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await tx(b, { account_id: a, date: DAY, amount: -1 });
    expect((await send(`/api/v1/budgets/${b}/accounts/${a}/close`, "POST")).status).toBe(200);
    await refused(b, { op: "duplicate", ids: [r.id] }, 422, "account_closed", r.id);
  });

  it("delete: a reconciled row needs the confirmation, and then goes; so does a reconciled other side", async () => {
    const b = await plan();
    const a1 = await account(b);
    const a2 = await account(b);
    const ok = await tx(b, { account_id: a1, date: DAY, amount: -1 });
    const rec = await tx(b, { account_id: a1, date: DAY, amount: -2 });
    await setSql(rec.id, "cleared = 'reconciled'");
    await refused(b, { op: "delete", ids: [ok.id, rec.id] }, 409, "transaction_reconciled", rec.id);
    expect((await get(b, ok.id)).id).toBe(ok.id);
    const t = await tx(b, { account_id: a1, date: DAY, amount: -1000, transfer_account_id: a2 });
    await setSql(t.transfer_transaction_id, "cleared = 'reconciled'");
    await refused(b, { op: "delete", ids: [t.id] }, 409, "transaction_reconciled", t.id);
    const res = await bulkOk(b, { op: "delete", ids: [rec.id, t.id], confirm_reconciled: true });
    expect(res.changed).toEqual([rec.id, t.id]);
    expect(res.others).toEqual([t.transfer_transaction_id]);
  });
});

describe("skips", () => {
  it("reports each reason", async () => {
    const b = await plan();
    const a = await account(b);
    const asset = await account(b, "otherAsset", 0);
    const card = await account(b, "creditCard", -50000);
    const cat = await category(b);
    const split = await tx(b, {
      account_id: a,
      date: DAY,
      amount: -300,
      subtransactions: [
        { amount: -100, category_id: cat },
        { amount: -200, category_id: cat },
      ],
    });
    const tracked = await tx(b, { account_id: asset, date: DAY, amount: -5 });
    const rec = await tx(b, { account_id: a, date: DAY, amount: -5 });
    await setSql(rec.id, "cleared = 'reconciled'");
    const done = await tx(b, { account_id: a, date: DAY, amount: -5, category_id: cat });
    const sb = (
      (await (
        await send(`/api/v1/budgets/${b}/accounts/${card}/transactions`, "GET").then((r) => r)
      ).json()) as Json
    ).data.transactions.find((t: Json) => t.payee_system === "starting_balance");
    const res = await bulkOk(b, {
      op: "categorize",
      ids: [split.id, tracked.id, rec.id, done.id, sb.id],
      value: cat,
    });
    expect(Object.fromEntries(res.skipped.map((s: Json) => [s.id, s.reason]))).toEqual({
      [split.id]: "split",
      [tracked.id]: "tracking_account",
      [rec.id]: "reconciled",
      [done.id]: "unchanged",
      [sb.id]: "starting_balance",
    });
    expect(res.changed).toEqual([]);
    const move = await bulkOk(b, { op: "move", ids: [rec.id, done.id], value: a });
    expect(move.skipped).toEqual([
      { id: rec.id, reason: "reconciled" },
      { id: done.id, reason: "unchanged" },
    ]);
  });
});

describe("history, race and limits", () => {
  it("a forced race leaves every row and the log unchanged, then answers 409", async () => {
    const b = await plan();
    const a = await account(b);
    const r1 = await tx(b, { account_id: a, date: DAY, amount: -1 });
    const r2 = await tx(b, { account_id: a, date: DAY, amount: -2 });
    const before = await logs(b);
    let tries = 0;
    await expect(
      bulkTransactions(
        env,
        actor,
        b,
        { op: "memo", ids: [r1.id, r2.id], value: "x" },
        {
          beforeWrite: async () => {
            tries += 1;
            await setSql(r2.id, `updated_at = '2030-01-0${tries}T00:00:00.000Z'`);
          },
        },
      ),
    ).rejects.toMatchObject({ name: "Conflict" });
    expect(tries).toBe(3);
    expect((await get(b, r1.id)).memo).toBeNull();
    expect((await get(b, r2.id)).memo).toBeNull();
    expect(await logs(b)).toBe(before);
  });

  it("101 ids are refused, 100 work", async () => {
    const b = await plan();
    const a = await account(b);
    const ids = [];
    for (let i = 0; i < 100; i++)
      ids.push((await tx(b, { account_id: a, date: DAY, amount: -1 })).id);
    const res = await bulk(b, { op: "flag", ids: [...ids, crypto.randomUUID()], value: "red" });
    expect(res.status).toBe(422);
    const ok = await bulkOk(b, { op: "flag", ids, value: "red" });
    expect(ok.changed).toHaveLength(100);
  }, 60000);

  it("a plan over the statement limit is refused whole", async () => {
    const b = await plan();
    const a = await account(b);
    const cat = await category(b);
    const lines = Array.from({ length: 50 }, () => ({ amount: -1, category_id: cat }));
    const ids = [];
    for (let i = 0; i < 9; i++) {
      ids.push((await tx(b, { account_id: a, date: DAY, amount: -50, subtransactions: lines })).id);
    }
    const before = await logs(b);
    const res = await bulk(b, { op: "duplicate", ids });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error.name).toBe("too_many_changes");
    expect(await logs(b)).toBe(before);
  }, 60000);
});

describe("unchangedSince", () => {
  it("holds while every row has its read updated_at, and fails after one changes", async () => {
    const b = await plan();
    const a = await account(b);
    const r1 = await tx(b, { account_id: a, date: DAY, amount: -1 });
    const r2 = await tx(b, { account_id: a, date: DAY, amount: -2 });
    const snap = [r1, r2, r1].map((r) => ({ id: r.id, updatedAt: r.updated_at as string }));
    const full = (await get(b, r1.id)).updated_at;
    expect(full).toBe(r1.updated_at);
    const db = getDb(env);
    const holds = async () =>
      (await db.all(sql`select exists ${txRepo.unchangedSince(db, snap)} as ok`))[0] as {
        ok: number;
      };
    expect((await holds()).ok).toBe(1);
    await setSql(r2.id, "updated_at = '2031-01-01T00:00:00.000Z'");
    expect((await holds()).ok).toBe(0);
  });
});
