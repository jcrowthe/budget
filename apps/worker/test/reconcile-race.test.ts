import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { reconcileAccount } from "../src/services/reconcile";
import { q } from "./bulk-helpers";
import { actor, seedWorkedExample } from "./reconcile-helpers";

/** `env` whose first `DB.batch` waits for `before()`; `batches()` counts the batches. */
function interleaved(before: (() => Promise<unknown>) | null) {
  let pending = before;
  let batches = 0;
  const db = new Proxy(env.DB, {
    get(t, k) {
      if (k === "batch") {
        return async (list: D1PreparedStatement[]) => {
          batches += 1;
          const f = pending;
          pending = null;
          if (f) await f();
          return t.batch(list);
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, batches: () => batches };
}

const nothingReconciled = async (a: string) => {
  expect(
    (
      await q(
        "select count(*) n from transactions where account_id = ? and cleared = 'reconciled'",
        a,
      )
    )[0]?.n,
  ).toBe(0);
  expect((await q("select last_reconciled_at l from accounts where id = ?", a))[0]?.l).toBeNull();
};

describe("reconcile: two requests at once (case 15)", () => {
  it("an unclear between the read and the batch is 409 reconcile_changed and writes nothing", async () => {
    const w = await seedWorkedExample();
    const logsBefore = (await q("select count(*) n from change_log where budget_id = ?", w.b))[0]
      ?.n;
    const e = interleaved(async () => {
      await env.DB.prepare("update transactions set cleared = 'uncleared' where id = ?")
        .bind(w.fuel)
        .run();
    });
    await expect(
      reconcileAccount(e.env, actor, w.b, w.checking, { statement_balance: 755500 }),
    ).rejects.toMatchObject({
      status: 409,
      code: "reconcile_changed",
      difference: -20000,
      cleared: 775500,
    });
    await nothingReconciled(w.checking);
    expect((await q("select count(*) n from change_log where budget_id = ?", w.b))[0]?.n).toBe(
      logsBefore,
    );
  });

  it("two adjustment reconciles interleaved write one adjustment; the other is 409", async () => {
    const w = await seedWorkedExample();
    const input = { statement_balance: 700000, create_adjustment: true };
    const e = interleaved(async () => {
      await reconcileAccount(env, actor, w.b, w.checking, input);
    });
    await expect(reconcileAccount(e.env, actor, w.b, w.checking, input)).rejects.toMatchObject({
      status: 409,
      code: "reconcile_changed",
    });
    const adj = await q(
      "select count(*) n from transactions where account_id = ? and payee_name = 'Reconciliation Balance Adjustment'",
      w.checking,
    );
    expect(adj[0]?.n).toBe(1);
    const marks = await q(
      "select count(*) n from change_log where entity_type = 'account' and entity_id = ? and action = 'update'",
      w.checking,
    );
    expect(marks[0]?.n).toBe(1);
  });

  it("two adjustment reconciles in the same millisecond still write one adjustment and one account log", async () => {
    const w = await seedWorkedExample();
    const input = { statement_balance: 700000, create_adjustment: true };
    const pinned = new Date().toISOString();
    const spy = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(pinned);
    try {
      const e = interleaved(async () => {
        await reconcileAccount(env, actor, w.b, w.checking, input);
      });
      await expect(reconcileAccount(e.env, actor, w.b, w.checking, input)).rejects.toMatchObject({
        status: 409,
        code: "reconcile_changed",
      });
    } finally {
      spy.mockRestore();
    }
    const adj = await q(
      "select count(*) n from transactions where account_id = ? and payee_name = 'Reconciliation Balance Adjustment'",
      w.checking,
    );
    expect(adj[0]?.n).toBe(1);
    const marks = await q(
      "select count(*) n from change_log where entity_type = 'account' and entity_id = ? and action = 'update'",
      w.checking,
    );
    expect(marks[0]?.n).toBe(1);
  });

  it("two reconciles with no difference both succeed; the second writes nothing", async () => {
    const w = await seedWorkedExample();
    const input = { statement_balance: 755500 };
    const e = interleaved(async () => {
      await reconcileAccount(env, actor, w.b, w.checking, input);
    });
    const second = await reconcileAccount(e.env, actor, w.b, w.checking, input);
    expect(second.reconciled_count).toBe(0);
    const n = await q(
      "select count(*) n from change_log where entity_type = 'transaction' and budget_id = ? and json_extract(after_json, '$.cleared') = 'reconciled'",
      w.b,
    );
    expect(n[0]?.n).toBe(6);
  });

  it("a stale cleared_balance is 409 before any batch", async () => {
    const w = await seedWorkedExample();
    const e = interleaved(null);
    await expect(
      reconcileAccount(e.env, actor, w.b, w.checking, {
        statement_balance: 755500,
        cleared_balance: 1,
      }),
    ).rejects.toMatchObject({ status: 409, code: "reconcile_changed" });
    expect(e.batches()).toBe(0);
    await nothingReconciled(w.checking);
  });
});
