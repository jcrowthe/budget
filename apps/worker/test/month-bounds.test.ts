import { env } from "cloudflare:test";
import { addMonths, toMonth } from "@budget/core/month";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

const actor = "user:tester@localhost";
const thisMonth = toMonth(new Date().toISOString());
const plusYears = (n: number) => addMonths(thisMonth, n * 12);

async function plan() {
  return (await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` })).id;
}

async function mcpMonth(bid: string, month: string) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (
    await mcpRpc("tools/call", { name: "get_plan_month", arguments: { budget_id: bid, month } }, 2)
  ).body.result as { isError?: boolean } | undefined;
}

describe("month bound on GET months/{month} and get_plan_month", () => {
  it("answers 200 for the current month and one year either side, 2015-01, 2005-06 and +10 years", async () => {
    const bid = await plan();
    for (const m of [
      thisMonth,
      plusYears(1),
      plusYears(-1),
      "2015-01-01",
      "2005-06-01",
      plusYears(10),
    ]) {
      expect((await json(`/api/v1/budgets/${bid}/months/${m}`)).status).toBe(200);
      expect((await mcpMonth(bid, m))?.isError).toBeFalsy();
    }
  });

  it("answers 422 for a month 11 years out, before 1970-01, and for the extremes", async () => {
    const bid = await plan();
    for (const m of [plusYears(11), "1969-12-01", "2199-12-01", "1900-01-01"]) {
      const res = await json(`/api/v1/budgets/${bid}/months/${m}`);
      expect(res.status, m).toBe(422);
      expect(((await res.json()) as { error: { name: string } }).error.name).toBe(
        "unprocessable_entity",
      );
      expect((await mcpMonth(bid, m))?.isError, m).toBe(true);
    }
  });
});

describe("GET month-range with a bad plan id", () => {
  it("answers 422 like the note PATCH, not 404", async () => {
    const res = await json("/api/v1/budgets/not-a-uuid/month-range");
    expect(res.status).toBe(422);
    const patch = await json(
      "/api/v1/budgets/not-a-uuid/months/2026-10-01",
      { method: "PATCH" },
      { note: "x" },
    );
    expect(patch.status).toBe(422);
  });
});
