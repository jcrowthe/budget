import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { exportPlan } from "../src/services/plan-export";
import { type Json, tool } from "./bulk-helpers";
import { json } from "./helpers";
import { buildF, counting, pinPlanClock, readZip, text } from "./plan-export-helpers";

// EXF-670: `now` within one day of the server's UTC date (pinned to 2026-11-16T12:00Z), and a bound on the months.
pinPlanClock();

const url = (bid: string, now: string) =>
  `/api/v1/budgets/${bid}/export?now=${encodeURIComponent(now)}`;
const RANGE = "2026-11-15 to 2026-11-17";

describe("EXF-670 Export Plan: now and the month bound", () => {
  it("accepts a now one day ahead and one day behind", async () => {
    const f = await buildF();
    for (const now of ["2026-11-17T09:05", "2026-11-15T09:05"]) {
      expect((await json(url(f.bid, now))).status, now).toBe(200);
    }
  });

  it("refuses two days ahead and a far year, naming the range", async () => {
    const f = await buildF();
    for (const now of ["2026-11-18T00:00", "2199-12-31T23:59", "2026-11-14T23:59"]) {
      const res = await json(url(f.bid, now));
      const body = (await res.json()) as Json;
      expect(res.status, now).toBe(422);
      expect(body.error.name ?? body.error.id).toBeTruthy();
      expect(JSON.stringify(body.error)).toContain("unprocessable_entity");
      expect(body.error.detail).toBe(`now must be within one day of the server's date (${RANGE})`);
    }
  });

  it("an unknown plan is 404 whatever the now", async () => {
    expect((await json(url("no-such-plan", "2199-12-31T23:59"))).status).toBe(404);
  });

  it("the tool refuses the same now with the same text", async () => {
    const f = await buildF();
    const r = await tool("export_budget", { budget_id: f.bid, now: "2199-12-31T23:59" });
    expect(r.result.isError).toBe(true);
    expect(JSON.stringify(r.result)).toContain(RANGE);
  });

  it("writes no month past the server's month + 24, with 15 D1 calls", async () => {
    const f = await buildF();
    // Money assigned in May 2029 (30 months ahead) by SQL.
    await env.DB.prepare(
      "insert into month_categories (budget_id, month, category_id, assigned, updated_at) values (?, '2029-05-01', ?, 1000, '2026-11-16T00:00:00.000Z')",
    )
      .bind(f.bid, f.ids.rent)
      .run();
    const c = counting();
    const { bytes } = await exportPlan(c.env, f.bid, { now: "2026-11-16T09:05" });
    expect(c.calls()).toBe(15);
    const plan = text(readZip(bytes)[0]?.data as Uint8Array);
    expect(plan).toContain('"Nov 2028"');
    expect(plan).not.toContain("2029");
    expect(plan).not.toContain('"Dec 2028"');
  }, 60_000);
});
