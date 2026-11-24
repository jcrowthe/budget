import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runInChangeSet } from "../src/history/change-set";
import { undoChangeSet } from "../src/services/undo";
import { account, actor, category, plan, send } from "./bulk-helpers";
import { json } from "./helpers";
import { countingEnv } from "./plaid-sync-helpers";
import { setOf } from "./undo-helpers";

const B = (bid: string) => `/api/v1/budgets/${bid}`;

/** Seeds `n` rows by batch inserts (the way bulk-call-count does: no per-row request). */
async function seedRows(bid: string, a: string, n: number, cid: string | null) {
  const stmts: D1PreparedStatement[] = [];
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    stmts.push(
      env.DB.prepare(
        "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, category_id) values (?, ?, ?, '2026-11-10', ?, 'uncleared', 1, '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z', ?)",
      ).bind(id, bid, a, -100 - i, cid),
    );
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return ids;
}

async function countUndo(setId: string, bid: string) {
  const c = countingEnv();
  await runInChangeSet(crypto.randomUUID(), () => undoChangeSet(c.env, actor, bid, setId));
  return c.calls.d1;
}

async function bulkClear(n: number) {
  const b = await plan();
  const a = await account(b);
  const ids = await seedRows(b, a, n, null);
  let set = "";
  for (let i = 0; i < ids.length; i += 100) {
    const r = await send(`${B(b)}/transactions/bulk`, "POST", {
      op: "clear",
      ids: ids.slice(i, i + 100),
    });
    expect(r.status).toBe(200);
    set = setOf(r);
  }
  return countUndo(set, b);
}

async function categoryDelete(n: number) {
  const b = await plan();
  const a = await account(b);
  const [C, T] = [await category(b, "Groceries"), await category(b, "Transportation")] as string[];
  await seedRows(b, a, n, C as string);
  const r = await json(`${B(b)}/categories/${C}?reassign_to=${T}`, { method: "DELETE" });
  expect(r.status).toBe(200);
  return countUndo(setOf(r), b);
}

describe("undo makes a constant number of D1 calls", () => {
  it("bulk clear over 10 and 100 rows", async () => {
    const [few, many] = [await bulkClear(10), await bulkClear(100)];
    console.log(`undo bulk clear: 10 rows ${few} calls, 100 rows ${many} calls`);
    expect(many).toBe(few);
    expect(few).toBeLessThanOrEqual(4);
  });
  it("category delete with reassign over 10 and 100 transactions", async () => {
    const [few, many] = [await categoryDelete(10), await categoryDelete(100)];
    console.log(`undo category delete: 10 tx ${few} calls, 100 tx ${many} calls`);
    expect(many).toBe(few);
    expect(few).toBeLessThanOrEqual(4);
  });
});
