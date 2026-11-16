import { addMonths, type Month, toMonth } from "@budget/core/month";
import {
  type AutoAssignInput,
  type AutoAssignPreview,
  type AutoAssignResult,
  type AutoAssignStrategy,
  AVERAGE_MONTHS,
  autoAssignPreview,
  autoAssignResult,
  historyFigures,
} from "@budget/schema/auto-assign";
import type { MonthCategory, MonthDetail } from "@budget/schema/months";
import { type PlanView, viewCategories } from "@budget/schema/plan-views";
import { sql } from "drizzle-orm";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as categoriesRepo from "../repositories/categories";
import * as monthCatRepo from "../repositories/month-categories";
import { getPlanMonths } from "./months";
import { todayUtc } from "./targets";

const MAX_ATTEMPTS = 5;
const isId = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export interface AutoAssignScope {
  category_ids?: string[];
  view?: PlanView;
}

/** The categories in scope with everything the arithmetic needs, from month reads the engine computes. */
async function loadScope(
  env: Env,
  budgetId: string,
  month: Month,
  scope: AutoAssignScope,
  today: string,
): Promise<AutoAssignInput[]> {
  if (!isId(budgetId)) throw new NotFound("Plan");
  if (scope.category_ids !== undefined && scope.view !== undefined) {
    throw new Error("Give category_ids or view, not both");
  }
  const db = getDb(env);
  const months: Month[] = [];
  for (let i = AVERAGE_MONTHS; i >= 0; i--) months.push(addMonths(month, -i));
  const [reads, rows] = await Promise.all([
    getPlanMonths(env, budgetId, months, today),
    categoriesRepo.listActive(db, budgetId),
  ]);
  const current = reads[reads.length - 1] as MonthDetail;
  const previous = reads.slice(0, -1);
  const byId = new Map(current.groups.flatMap((g) => g.categories).map((c) => [c.id, c]));
  let ids: string[];
  if (scope.category_ids) {
    ids = [...new Set(scope.category_ids)];
    if (ids.some((id) => !byId.has(id))) throw new NotFound("Category");
  } else {
    ids = viewCategories(current, scope.view ?? "all").map((c) => c.id);
  }
  const created = new Map(rows.map((r) => [r.id, toMonth(r.createdAt)]));
  return ids.map((id): AutoAssignInput => {
    const c = byId.get(id) as MonthDetail["groups"][number]["categories"][number];
    const figures = previous.map((d) => {
      const p = d.groups.flatMap((g) => g.categories).find((x) => x.id === id);
      return { month: d.month, assigned: p?.assigned ?? 0, activity: p?.activity ?? 0 };
    });
    const firstActive = figures.find((f) => f.assigned !== 0 || f.activity !== 0)?.month;
    const createdMonth = created.get(id) ?? month;
    const first =
      firstActive !== undefined && firstActive < createdMonth ? firstActive : createdMonth;
    return {
      id,
      assigned: c.assigned,
      carried: c.carried,
      activity: c.activity,
      target: c.target,
      ...historyFigures(month, figures, first),
    };
  });
}

export async function previewAutoAssign(
  env: Env,
  budgetId: string,
  month: Month,
  scope: AutoAssignScope,
  today: string = todayUtc(),
): Promise<AutoAssignPreview> {
  return autoAssignPreview(await loadScope(env, budgetId, month, scope, today));
}

interface Cell {
  id: string;
  before: number | undefined;
  after: number;
}

/**
 * Test seam: the statements of one run. A change_log row per cell first, then the cell writes, every row
 * guarded on all cells still holding what was read; a later write also needs the one before it to have changed
 * a row, so the cells are written together or not at all.
 */
export function buildAutoAssignBatch(
  db: Db,
  actor: string,
  v: { budget_id: string; month: string; strategy: AutoAssignStrategy },
  runId: string,
  cells: Cell[],
  now: string,
) {
  const keyed = cells.map((s) => ({
    ...s,
    cell: { budgetId: v.budget_id, month: v.month, categoryId: s.id },
  }));
  const allHold = sql`${sql.join(
    keyed.map((s) => sql`exists ${monthCatRepo.holds(db, s.cell, s.before)}`),
    sql` and `,
  )}`;
  const guard = db.select({ x: sql`1` }).from(sql`(select 1)`).where(allHold);
  const logs = keyed.map((s) =>
    changeLogInsertIf(
      db,
      {
        budgetId: v.budget_id,
        actor,
        action: "update",
        entityType: "month_category",
        entityId: `${s.id}:${v.month}`,
        before: { month: v.month, category_id: s.id, assigned: s.before ?? 0 },
        after: {
          month: v.month,
          category_id: s.id,
          assigned: s.after,
          auto_assign: { id: runId, strategy: v.strategy },
        },
      },
      guard,
    ),
  );
  const writes = keyed.map((s, i) =>
    monthCatRepo.setIfHoldsStmt(
      db,
      s.cell,
      s.before,
      s.after,
      now,
      i === 0 ? allHold : sql`changes() > 0`,
    ),
  );
  return { stmts: [...logs, ...writes], logCount: logs.length };
}

/**
 * Applies one option to the categories in scope for a month, in one batch: every category whose Assigned
 * changes gets a change_log row (one `auto_assign.id` per run) and its new Assigned. A lost race writes
 * nothing and the run is recomputed from the new figures (so Underfunded then adds 0).
 */
export async function autoAssign(
  env: Env,
  actor: string,
  input: { budget_id: string; month: Month; strategy: AutoAssignStrategy } & AutoAssignScope,
  today: string = todayUtc(),
): Promise<AutoAssignResult> {
  const db = getDb(env);
  const { budget_id: budgetId, month, strategy } = input;
  const runId = crypto.randomUUID();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const inputs = await loadScope(env, budgetId, month, input, today);
    const rows = await Promise.all(inputs.map((c) => monthCatRepo.find(db, budgetId, month, c.id)));
    // What the engine read and what the cell holds must agree, or another writer got in between.
    if (inputs.some((c, i) => (rows[i]?.assigned ?? 0) !== c.assigned)) continue;
    const cells: Cell[] = [];
    inputs.forEach((c, i) => {
      const after = autoAssignResult(c, strategy);
      if (after !== c.assigned) cells.push({ id: c.id, before: rows[i]?.assigned, after });
    });
    const changed: MonthCategory[] = cells.map((c) => ({
      month,
      category_id: c.id,
      assigned: c.after,
    }));
    if (cells.length === 0) return { month, strategy, changed: [] };
    const { stmts, logCount } = buildAutoAssignBatch(
      db,
      actor,
      { budget_id: budgetId, month, strategy },
      runId,
      cells,
      new Date().toISOString(),
    );
    const results = await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    const first = results[logCount];
    if (first && first.meta.changes > 0) return { month, strategy, changed };
  }
  throw new Conflict("Assigned amounts");
}
