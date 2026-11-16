import { describe, expect, it } from "vitest";
import { json } from "./helpers";
import { account, base, examplePlan, type Json, plan, post, TODAY } from "./report-example";
import { apiPaths, listedToolNames, mcpRpc } from "./surface";

const age = async (bid: string, q = TODAY) =>
  (await (await json(`${base(bid)}/reports/age-of-money?${q}`)).json()) as Json;
async function mcp(name: string, args: unknown) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body as Json;
}

describe("Age of Money", () => {
  it("the example, by day, and the tool returns the same data", async () => {
    const { bid } = await examplePlan();
    expect((await age(bid)).data).toEqual({
      current_days: 122,
      months: [
        { month: "2026-10-01", days: 114 },
        { month: "2026-11-01", days: 122 },
      ],
    });
    expect((await age(bid, "today=2026-10-31")).data).toEqual({
      current_days: 114,
      months: [{ month: "2026-10-01", days: 114 }],
    });
    expect((await age(bid, "today=2026-10-09")).data).toEqual({
      current_days: 105,
      months: [{ month: "2026-10-01", days: 105 }],
    });
    expect((await age(bid, "today=2026-10-08")).data).toEqual({ current_days: null, months: [] });
    const body = await mcp("get_age_of_money", { budget_id: bid, today: "2026-11-15" });
    expect(body.result.structuredContent ?? JSON.parse(body.result.content[0].text)).toEqual(
      (await age(bid)).data,
    );
  });

  it("counts a split once, ignores internal transfers and card spending (plan Z)", async () => {
    const bid = await plan();
    const chk = await account(bid, "Z Checking", "checking", 1000000, "2026-01-01");
    const sav = await account(bid, "Z Savings", "savings", 0, "2026-01-01");
    const card = await account(bid, "Z Card", "creditCard", 0, "2026-01-01");
    await post(bid, {
      account_id: chk,
      date: "2026-01-03",
      amount: -50000,
      transfer_account_id: card,
    });
    for (let d = 11; d <= 18; d++) {
      await post(bid, {
        account_id: chk,
        date: `2026-01-${d}`,
        amount: -10000,
        payee_name: "Z Shop",
      });
    }
    await post(bid, {
      account_id: chk,
      date: "2026-01-20",
      amount: -100000,
      payee_name: "Z Shop",
      subtransactions: [{ amount: -60000 }, { amount: -40000 }],
    });
    await post(bid, {
      account_id: chk,
      date: "2026-01-21",
      amount: -300000,
      transfer_account_id: sav,
    });
    await post(bid, { account_id: card, date: "2026-01-25", amount: -20000, payee_name: "Z Shop" });
    expect((await age(bid, "today=2026-01-31")).data).toEqual({
      current_days: 13,
      months: [{ month: "2026-01-01", days: 13 }],
    });
  });

  it("has no value below 10 outflows", async () => {
    const bid = await plan();
    const chk = await account(bid, "E Checking", "checking", 500000, "2026-11-01");
    for (const d of ["02", "03", "04"]) {
      await post(bid, {
        account_id: chk,
        date: `2026-11-${d}`,
        amount: -10000,
        payee_name: "E Shop",
      });
    }
    expect((await age(bid)).data).toEqual({ current_days: null, months: [] });
  });

  it("is on the surface; an unknown plan is 404 and a bad today 422", async () => {
    expect(await apiPaths()).toContain("/api/v1/budgets/{budget_id}/reports/age-of-money");
    expect(await listedToolNames()).toContain("get_age_of_money");
    const { bid } = await examplePlan();
    expect((await json(`${base("nope")}/reports/age-of-money`)).status).toBe(404);
    expect((await json(`${base(bid)}/reports/age-of-money?today=2026-02-30`)).status).toBe(422);
  });
});
