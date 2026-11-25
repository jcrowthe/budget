import { type CategoryGroup, CategoryGroupMove } from "@budget/schema/categories";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { Conflict, NotFound } from "../middleware/errors";
import * as groupsRepo from "../repositories/category-groups";
import { type LogBase, logSelectStmt } from "../repositories/guards";
import {
  GROUP_PINNED,
  groupToApi,
  InvalidMoveTarget,
  MoveLocked,
  type MovePlan,
  type Placement,
  placeInScope,
  planMove,
  requirePlan,
} from "./categories";

const MAX_ATTEMPTS = 5;

function groupMoveEntries(
  scope: readonly groupsRepo.CategoryGroupRow[],
  moved: groupsRepo.CategoryGroupRow,
  plan: MovePlan,
  p: Placement,
): groupsRepo.GroupMoveEntry[] {
  const { prev, next } = placeInScope(
    scope.map((r) => ({ id: r.id, sort: r.sortOrder, kind: r.kind })),
    moved.id,
    p,
  );
  const out = new Map<string, groupsRepo.GroupMoveEntry>();
  out.set(moved.id, { i: moved.id, o: moved.sortOrder, n: plan.sort, w: 1 });
  for (const r of plan.renumber) out.set(r.id, { i: r.id, o: r.from, n: r.to, w: 1 });
  for (const n of [prev, next]) {
    if (n && !out.has(n.id)) out.set(n.id, { i: n.id, o: n.sort, n: n.sort, w: 0 });
  }
  return [...out.values()];
}

/**
 * Moves a category group before or after another (neither: the end). One batch: change_log rows for the moved
 * group and any renumbered groups (never the Credit Card Payments group, which is the renormalize anchor unless
 * it is the one moved), then the sort update. Every group keeps its categories.
 */
export async function moveCategoryGroup(
  env: Env,
  actor: string,
  input: { budget_id: string; group_id: string } & CategoryGroupMove,
): Promise<CategoryGroup> {
  const v = CategoryGroupMove.parse({
    before_group_id: input.before_group_id,
    after_group_id: input.after_group_id,
  });
  const db = getDb(env);
  await requirePlan(db, input.budget_id);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const all = await groupsRepo.listActive(db, input.budget_id);
    const moved = all.find((g) => g.id === input.group_id);
    if (!moved) throw new NotFound("Category group");
    // The month engine lists the Credit Card Payments group first whatever its sort_order, and a group created
    // after a card sorts BEFORE it in the data. So plan over the displayed order of the ordinary groups only.
    if (moved.kind !== null) throw new MoveLocked("payment_group_locked", GROUP_PINNED);
    const scope = all.filter((g) => g.kind === null);
    const pinned = new Set(all.filter((g) => g.kind !== null).map((g) => g.id));
    let placement: Placement = { before: v.before_group_id, after: v.after_group_id };
    if (placement.before && pinned.has(placement.before)) {
      throw new InvalidMoveTarget("Nothing can be placed above the Credit Card Payments group");
    }
    // After the pinned group = first among the ordinary groups.
    if (placement.after && pinned.has(placement.after)) {
      placement = { before: scope.find((g) => g.id !== moved.id)?.id };
    }
    if ([placement.before, placement.after].includes(moved.id)) {
      throw new InvalidMoveTarget("A group can't be moved next to itself");
    }
    const plan = planMove(
      scope.map((r) => ({ id: r.id, sort: r.sortOrder, kind: r.kind })),
      moved.id,
      placement,
    );
    if (plan === "noop") return groupToApi(moved);
    const json = JSON.stringify(groupMoveEntries(scope, moved, plan, placement));
    const now = new Date().toISOString();
    const guard = groupsRepo.moveGuard(moved.budgetId, json, moved);
    const base: LogBase = {
      budgetId: moved.budgetId,
      actor,
      action: "update",
      entityType: "category_group",
      createdAt: now,
    };
    const [, result] = await db.batch([
      logSelectStmt(db, base, groupsRepo.moveInner(moved.budgetId, json, guard), {
        entityId: sql`id`,
        before: groupsRepo.groupJson(),
        after: groupsRepo.groupMovedJson(),
      }),
      groupsRepo.moveSortsStmt(db, moved.budgetId, json, now, guard),
    ]);
    if (result.meta.changes > 0)
      return groupToApi({ ...moved, sortOrder: plan.sort, updatedAt: now });
  }
  throw new Conflict("Category group order");
}
