import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { moveMoney, setAssigned } from "../src/services/months";
import { listRecentMoves } from "../src/services/recent-moves";
import { json } from "./helpers";
import { counting } from "./plan-export-helpers";

const actor = "user:tester@localhost";
const NOV = "2026-11-01";

describe("recent moves: D1 calls do not grow with the moves", () => {
  it("makes 2 calls for 10 and for 100 moves", async () => {
    const seen: number[] = [];
    for (const n of [10, 100]) {
      const b = await createBudget(env, actor, { name: `ZZ-TEST ${crypto.randomUUID()}` });
      const d = (await (await json(`/api/v1/budgets/${b.id}/months/${NOV}`)).json()) as {
        data: { groups: { categories: { id: string }[] }[] };
      };
      const ids = d.data.groups.flatMap((g) => g.categories.map((c) => c.id));
      const [a, c] = [ids[0] as string, ids[1] as string];
      await setAssigned(env, actor, {
        budget_id: b.id,
        month: NOV,
        category_id: a,
        assigned: 10_000_000,
      });
      for (let i = 0; i < n - 1; i++) {
        await moveMoney(env, actor, {
          budget_id: b.id,
          month: NOV,
          from_category_id: a,
          to_category_id: c,
          amount: 1000,
        } as never);
      }
      const k = counting();
      const got = await listRecentMoves(k.env, actor, { budget_id: b.id });
      expect(got).toHaveLength(n);
      seen.push(k.calls());
    }
    expect(seen).toEqual([2, 2]);
  });
});
