import { describe, expect, it } from "vitest";
import { deleteCategory, deleteCategoryGroup, groupUsage } from "../src/services/category-delete";
import { seedBigGroup } from "./bound-lists-helpers";
import { actor } from "./category-helpers";
import { countingEnv } from "./plaid-sync-helpers";

// Measured on deb0f99 at 3 and 10 categories (and the same after the fix): the fix changes how the ids are
// bound, not the number of statements.
describe("EXF-883: D1 calls of a group's delete and usage", () => {
  for (const n of [3, 120]) {
    it(`group of ${n}: delete without history takes 6 calls`, async () => {
      const s = await seedBigGroup(n);
      const c = countingEnv();
      c.reset();
      await deleteCategoryGroup(c.env, actor, { budget_id: s.bid, group_id: s.groupId });
      expect(c.calls.d1).toBe(6);
    });

    it(`group of ${n}: delete with history and reassign_to takes 8 calls`, async () => {
      const s = await seedBigGroup(n, { history: true });
      const c = countingEnv();
      c.reset();
      await deleteCategoryGroup(c.env, actor, {
        budget_id: s.bid,
        group_id: s.groupId,
        reassign_to: s.targetId,
      });
      expect(c.calls.d1).toBe(8);
    });

    it(`group of ${n}: usage takes 4 calls`, async () => {
      const s = await seedBigGroup(n);
      const c = countingEnv();
      c.reset();
      await groupUsage(c.env, s.bid, s.groupId);
      expect(c.calls.d1).toBe(4);
    });
  }

  it("a category delete takes 5 calls, or 7 with history and reassign_to", async () => {
    const a = await seedBigGroup(3);
    const c = countingEnv();
    c.reset();
    await deleteCategory(c.env, actor, { budget_id: a.bid, category_id: a.ids[0] as string });
    expect(c.calls.d1).toBe(5);
    const b = await seedBigGroup(3, { history: true });
    c.reset();
    await deleteCategory(c.env, actor, {
      budget_id: b.bid,
      category_id: b.ids[0] as string,
      reassign_to: b.targetId,
    });
    expect(c.calls.d1).toBe(7);
  });
});
