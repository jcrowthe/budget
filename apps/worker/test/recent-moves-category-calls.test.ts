import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { moveMoney, setAssigned } from "../src/services/months";
import { listRecentMoves } from "../src/services/recent-moves";
import { json } from "./helpers";
import { counting } from "./plan-export-helpers";
import { undo } from "./undo-helpers";

const actor = "user:tester@localhost";
const NOV = "2026-11-01";

async function seed() {
  const b = await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` });
  const d = (await (await json(`/api/v1/budgets/${b.id}/months/${NOV}`)).json()) as {
    data: { groups: { categories: { id: string }[] }[] };
  };
  const ids = d.data.groups.flatMap((g) => g.categories.map((c) => c.id));
  return { bid: b.id, ids: ids as string[] };
}
const mv = (bid: string, from: string, to: string) =>
  moveMoney(env, actor, {
    budget_id: bid,
    month: NOV,
    from_category_id: from,
    to_category_id: to,
    amount: 1000,
  } as never);

describe("recent moves by category: D1 calls do not grow with the moves", () => {
  it("makes 2 calls for 10 and for 100 moves", async () => {
    const seen: number[] = [];
    for (const n of [10, 100]) {
      const { bid, ids } = await seed();
      const [a, b, c] = [ids[0] as string, ids[1] as string, ids[2] as string];
      for (const x of [a, b]) {
        await setAssigned(env, actor, {
          budget_id: bid,
          month: NOV,
          category_id: x,
          assigned: 10_000_000,
        });
      }
      for (let i = 0; i < n - 1; i++) await mv(bid, a, c);
      for (let i = 0; i < n; i++) await mv(bid, b, c);
      const k = counting();
      const got = await listRecentMoves(k.env, actor, {
        budget_id: bid,
        category_id: a,
        month: NOV,
      });
      // n - 1 moves a -> c, plus a's own assigning
      expect(got).toHaveLength(n);
      seen.push(k.calls());
    }
    expect(seen).toEqual([2, 2]);
  });

  it("still makes 2 calls for a list that contains a redo", async () => {
    const { bid, ids } = await seed();
    const [a, b] = [ids[0] as string, ids[1] as string];
    await setAssigned(env, actor, { budget_id: bid, month: NOV, category_id: a, assigned: 100000 });
    const res = await json(
      `/api/v1/budgets/${bid}/months/${NOV}/moves`,
      { method: "POST" },
      { from: a, to: b, amount: 1000 },
    );
    const u = await undo(bid, res.headers.get("Budget-Change-Set") as string);
    await undo(bid, u.header as string);
    const k = counting();
    const got = await listRecentMoves(k.env, actor, { budget_id: bid, category_id: a });
    expect(got.map((e) => e.method)).toContain("redo");
    expect(k.calls()).toBe(2);
  });
});
