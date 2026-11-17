import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { createCategory, createCategoryGroup } from "../src/services/categories";
import { exportPlan } from "../src/services/plan-export";
import { account, actor } from "./bulk-helpers";
import { buildF, counting, NOW, pinPlanClock, readZip } from "./plan-export-helpers";

// EXF-476, "Services: D1 calls" (docs/conventions.md): the export reads a whole plan, and its D1 calls
// do not grow with the months, categories, accounts or transactions.
pinPlanClock();

// 16: EXF-537 adds one set query (the card flows) to getPlanMonths, which the export reads (was 15).
const CALLS = 16;

const ins =
  "insert into transactions (id, budget_id, account_id, date, payee_name, category_id, inflow_to_ready_to_assign, memo, amount, cleared, approved, created_at, updated_at, transfer_account_id, transfer_transaction_id, parent_transaction_id, split_index) values (?, ?, ?, ?, ?, ?, 0, ?, ?, 'cleared', 1, ?, ?, ?, ?, ?, ?)";

/** A plan with 4 accounts, 40 categories, 24 months (2025-01 .. 2026-12) and `n` plain transactions plus splits and transfers. */
async function large(n: number) {
  const bid = (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
  const accounts: string[] = [];
  for (let i = 0; i < 4; i++) accounts.push(await account(bid, "checking"));
  const g = await createCategoryGroup(env, actor, { budget_id: bid, name: "ZZ Big" });
  const cats: string[] = [];
  for (let i = 0; i < 40; i++) {
    cats.push(
      (await createCategory(env, actor, { budget_id: bid, group_id: g.id, name: `ZZ Cat ${i}` }))
        .id,
    );
  }
  const month = (i: number) =>
    `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  const stamp = "2026-01-01T00:00:00.000Z";
  const stmts: D1PreparedStatement[] = [];
  const row = (v: (string | number | null)[]) => stmts.push(env.DB.prepare(ins).bind(...v));
  const acct = (i: number) => accounts[i % 4] as string;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const date = `${month(i % 24)}-${String((i % 27) + 1).padStart(2, "0")}`;
    row([
      crypto.randomUUID(),
      bid,
      acct(i),
      date,
      `ZZ Payee ${i % 17}`,
      cats[i % 40] as string,
      null,
      -(1000 + i),
      stamp,
      stamp,
      null,
      null,
      null,
      null,
    ]);
    total++;
  }
  for (let i = 0; i < 10; i++) {
    const parent = crypto.randomUUID();
    const date = `${month(i * 2)}-15`;
    row([
      parent,
      bid,
      acct(i),
      date,
      "ZZ Split",
      null,
      null,
      -3000,
      stamp,
      stamp,
      null,
      null,
      null,
      null,
    ]);
    for (let k = 0; k < 3; k++) {
      row([
        crypto.randomUUID(),
        bid,
        acct(i),
        date,
        null,
        cats[(i + k) % 40] as string,
        `line ${k}`,
        -1000,
        stamp,
        stamp,
        null,
        null,
        parent,
        k,
      ]);
    }
    total += 4;
  }
  for (let i = 0; i < 20; i++) {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const date = `${month(i % 24)}-20`;
    row([a, bid, acct(i), date, null, null, null, -5000, stamp, stamp, acct(i + 1), b, null, null]);
    row([b, bid, acct(i + 1), date, null, null, null, 5000, stamp, stamp, acct(i), a, null, null]);
    total += 2;
  }
  for (let m = 0; m < 24; m++) {
    for (const c of cats) {
      stmts.push(
        env.DB.prepare(
          "insert into month_categories (budget_id, month, category_id, assigned, updated_at) values (?, ?, ?, 1000, ?)",
        ).bind(bid, `${month(m)}-01`, c, stamp),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return { bid, total };
}

describe("EXF-476 D1 calls", () => {
  it("makes 16 calls for a small plan and for 1,000 transactions over 24 months", async () => {
    const f = await buildF();
    const c = counting();
    await exportPlan(c.env, f.bid, { now: NOW });
    expect(c.calls(), "fixture F").toBe(CALLS);

    const big = await large(1000);
    c.reset();
    const t0 = performance.now();
    const { bytes } = await exportPlan(c.env, big.bid, { now: NOW });
    const ms = Math.round(performance.now() - t0);
    expect(c.calls(), "large plan").toBe(CALLS);
    const [planFile, registerFile] = readZip(bytes);
    const plan = new TextDecoder().decode(planFile?.data).split("\r\n");
    const register = new TextDecoder().decode(registerFile?.data).split("\r\n");
    // 24 months of every category (the 40 added and the plan's defaults); rows: the seeded ones less the 10 split
    // parents, plus the 4 Starting Balances.
    expect((plan.length - 1) % 24).toBe(0);
    expect((plan.length - 1) / 24).toBeGreaterThanOrEqual(40);
    expect(register.length).toBe(1 + big.total - 10 + 4);
    console.log(
      `plan-export: ${big.total} transactions, 24 months, ${ms} ms (zip ${bytes.length} bytes)`,
    );
  }, 120_000);
});
