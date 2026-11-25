import {
  type MonthDetail as CoreMonthDetail,
  computeMonth,
  computeMonths,
  type EngineInput,
} from "@budget/core/budget-engine";
import { addMonths, type Month, toMonth } from "@budget/core/month";
import { monthTotals, viewTotals } from "@budget/schema/month-totals";
import {
  AssignedSet,
  MoneyMove,
  type MonthCategory,
  type MonthCategoryDetail,
  type MonthDetail,
  type MonthGroupDetail,
  MonthNoteSet,
  type MonthRange,
  type MonthSummary,
  type MonthTotals,
} from "@budget/schema/months";
import { type PlanView, viewDetail } from "@budget/schema/plan-views";
import { dayBefore } from "@budget/schema/recurrence";
import { type UpcomingSource, upcomingByCategory } from "@budget/schema/scheduled-upcoming";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { type ChangeLogEntry, changeLogInsert, changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as cardFlowsRepo from "../repositories/card-flows";
import * as categoriesRepo from "../repositories/categories";
import * as groupsRepo from "../repositories/category-groups";
import * as monthCatRepo from "../repositories/month-categories";
import * as monthRangeRepo from "../repositories/month-range";
import * as monthsRepo from "../repositories/months";
import { planActivity } from "../repositories/plan-activity";
import * as scheduledRepo from "../repositories/scheduled-transactions";
import * as snoozesRepo from "../repositories/target-snoozes";
import * as targetsRepo from "../repositories/targets";
import { todayUtc } from "./targets";

// Type-level check: the engine's read model and the API schema are the same shape, both ways.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
// The API's category also carries its `note`, which the engine does not know: attached after computeMonth.
type EngineShape = Omit<MonthDetail, "groups"> & {
  groups: (Omit<MonthGroupDetail, "categories"> & {
    categories: Omit<
      MonthCategoryDetail,
      "note" | "target_snoozed" | "upcoming" | "upcoming_count" | "available_after_upcoming"
    >[];
  })[];
};
const _sameShape: Same<CoreMonthDetail, EngineShape> = true;
void _sameShape;

async function requirePlan(db: Db, budgetId: string) {
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
}

const mcEntityId = (categoryId: string, month: string) => `${categoryId}:${month}`;

/** Test seam: builds the setAssigned batch with a custom change_log entry (to prove atomicity). */
export function buildSetAssignedBatch(
  db: Db,
  row: monthCatRepo.MonthCategoryRow,
  log: ChangeLogEntry,
  before?: number,
) {
  return [
    changeLogInsertIf(db, log, monthCatRepo.holds(db, row, before)),
    monthCatRepo.setIfHoldsStmt(db, row, before, row.assigned, row.updatedAt),
  ] as const;
}

const MAX_ATTEMPTS = 5;

/**
 * Both writers below: the change_log insert comes FIRST and the cell write second, each guarded by "the cell
 * still holds what was read". A lost race writes neither (so the log never records a change that did not
 * happen); the caller re-reads and retries a few times, then throws Conflict. Concurrent writers never lose
 * an update and the logged before/after chain matches the data.
 */
export async function setAssigned(
  env: Env,
  actor: string,
  input: AssignedSet,
): Promise<MonthCategory> {
  const v = AssignedSet.parse(input);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  if (!(await categoriesRepo.findActive(db, v.budget_id, v.category_id))) {
    throw new NotFound("Category");
  }
  const result: MonthCategory = {
    month: v.month,
    category_id: v.category_id,
    assigned: v.assigned,
  };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = (await monthCatRepo.find(db, v.budget_id, v.month, v.category_id))?.assigned;
    const row: monthCatRepo.MonthCategoryRow = {
      budgetId: v.budget_id,
      month: v.month,
      categoryId: v.category_id,
      assigned: v.assigned,
      updatedAt: new Date().toISOString(),
    };
    const [, write] = await db.batch([
      ...buildSetAssignedBatch(
        db,
        row,
        {
          budgetId: v.budget_id,
          actor,
          action: "update",
          entityType: "month_category",
          entityId: mcEntityId(v.category_id, v.month),
          before: { month: v.month, category_id: v.category_id, assigned: before ?? 0 },
          after: result,
        },
        before,
      ),
    ]);
    if (write.meta.changes > 0) return result;
  }
  throw new Conflict("Assigned amount");
}

/**
 * Test seam: the statements of one move. The change_log rows come first and the cell writes second, every
 * statement guarded on all cells still holding what was read; the second write also needs the first to have
 * changed a row, so the two sides are written together or not at all.
 */
export function buildMoveBatch(
  db: Db,
  actor: string,
  v: MoneyMove,
  moveId: string,
  reads: { id: string; delta: number; before: number | undefined }[],
  now: string,
) {
  const cells = reads.map((s) => ({
    ...s,
    cell: { budgetId: v.budget_id, month: v.month, categoryId: s.id },
  }));
  const out: MonthCategory[] = cells.map((s) => ({
    month: v.month,
    category_id: s.id,
    assigned: (s.before ?? 0) + s.delta,
  }));
  const allHold = sql`${sql.join(
    cells.map((s) => sql`exists ${monthCatRepo.holds(db, s.cell, s.before)}`),
    sql` and `,
  )}`;
  const logs = cells.map((s, i) =>
    changeLogInsertIf(
      db,
      {
        budgetId: v.budget_id,
        actor,
        action: "update",
        entityType: "month_category",
        entityId: mcEntityId(s.id, v.month),
        before: { month: v.month, category_id: s.id, assigned: s.before ?? 0 },
        after: {
          ...out[i],
          move: {
            id: moveId,
            month: v.month,
            from_category_id: v.from_category_id,
            to_category_id: v.to_category_id,
            amount: v.amount,
            kind: v.kind ?? "move",
          },
        },
      },
      db.select({ x: sql`1` }).from(sql`(select 1)`).where(allHold),
    ),
  );
  const writes = cells.map((s, i) =>
    monthCatRepo.setIfHoldsStmt(
      db,
      s.cell,
      s.before,
      out[i]?.assigned ?? 0,
      now,
      i === 0 ? allHold : sql`changes() > 0`,
    ),
  );
  return { stmts: [...logs, ...writes], logCount: logs.length, out };
}

/**
 * Moves `amount` of Assigned in a month from one category to another. A null side is Ready to Assign: only the
 * other category's Assigned changes. One batch; every row of the call shares one `move.id` in its change_log
 * `after` (see docs/rta-moves-design.md for how Recent Moves and Undo read it).
 */
export class MoveStale extends Error {
  constructor() {
    super("The category changed since it was read");
    this.name = "MoveStale";
  }
}

/**
 * `expect` ties the move to what the caller computed its amount from: when that category's Assigned is no longer
 * `expect.assigned` (read inside the guarded loop), it throws `MoveStale` and writes nothing. A cover uses it so
 * two concurrent covers cannot both move the same overspent amount.
 */
export async function moveMoney(
  env: Env,
  actor: string,
  input: MoneyMove,
  expect?: { categoryId: string; assigned: number },
): Promise<{ move_id: string; cells: MonthCategory[] }> {
  const v = MoneyMove.parse(input);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  const sides = [
    { id: v.from_category_id, delta: -v.amount },
    { id: v.to_category_id, delta: v.amount },
  ].filter((s): s is { id: string; delta: number } => s.id !== null);
  for (const s of sides) {
    if (!(await categoriesRepo.findActive(db, v.budget_id, s.id))) throw new NotFound("Category");
  }
  const moveId = crypto.randomUUID();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const now = new Date().toISOString();
    const reads = await Promise.all(
      sides.map(async (s) => ({
        ...s,
        before: (await monthCatRepo.find(db, v.budget_id, v.month, s.id))?.assigned,
      })),
    );
    const seen = reads.find((r) => r.id === expect?.categoryId);
    if (expect && seen && (seen.before ?? 0) !== expect.assigned) throw new MoveStale();
    const { stmts, logCount, out } = buildMoveBatch(db, actor, v, moveId, reads, now);
    const results = await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    const first = results[logCount];
    if (first && first.meta.changes > 0) return { move_id: moveId, cells: out };
  }
  throw new Conflict("Assigned amounts");
}

export async function setMonthNote(
  env: Env,
  actor: string,
  input: MonthNoteSet,
): Promise<{ month: string; note: string | null }> {
  const v = MonthNoteSet.parse(input);
  const note = v.note?.trim() || null;
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  const before = await monthsRepo.find(db, v.budget_id, v.month);
  await db.batch([
    monthsRepo.upsertNoteStmt(db, {
      budgetId: v.budget_id,
      month: v.month,
      note,
      updatedAt: new Date().toISOString(),
    }),
    changeLogInsert(db, {
      budgetId: v.budget_id,
      actor,
      action: "update",
      entityType: "month",
      entityId: v.month,
      before: { month: v.month, note: before?.note ?? null },
      after: { month: v.month, note },
    }),
  ]);
  return { month: v.month, note };
}

async function loadInput(
  db: Db,
  budgetId: string,
  activityBefore: string,
  full = false,
): Promise<
  EngineInput & { categoryNotes: Map<string, string | null>; upcomingSources: UpcomingSource[] }
> {
  const [
    groups,
    categories,
    assignments,
    notes,
    activity,
    targetRows,
    snoozeRows,
    flows,
    upcomingSources,
  ] = await Promise.all([
    groupsRepo.listActive(db, budgetId),
    categoriesRepo.listActive(db, budgetId),
    monthCatRepo.listForBudget(db, budgetId),
    monthsRepo.listNotes(db, budgetId),
    planActivity(db, budgetId, activityBefore),
    full ? targetsRepo.listForBudget(db, budgetId) : Promise.resolve([]),
    full ? snoozesRepo.listForBudget(db, budgetId) : Promise.resolve([]),
    full ? cardFlowsRepo.cardFlows(db, budgetId, activityBefore) : Promise.resolve([]),
    // `activityBefore` is the first day after the latest month read: the day before it is that month's last.
    full
      ? scheduledRepo.listUpcomingSources(db, budgetId, dayBefore(activityBefore))
      : Promise.resolve([]),
  ]);
  const snoozedBy = new Map<string, Month[]>();
  for (const r of snoozeRows)
    snoozedBy.set(r.categoryId, [...(snoozedBy.get(r.categoryId) ?? []), r.month]);
  return {
    upcomingSources,
    categoryNotes: new Map(categories.map((c) => [c.id, c.note ?? null])),
    groups,
    categories,
    assignments: assignments.map((a) => ({
      categoryId: a.categoryId,
      month: a.month,
      assigned: a.assigned,
    })),
    activity,
    cardFlows: flows,
    notes: notes.map((n) => ({ month: n.month, note: n.note })),
    targets: targetRows.map((r) => ({
      categoryId: r.categoryId,
      ...targetsRepo.toDefinition(r),
      snoozed_months: snoozedBy.get(r.categoryId) ?? [],
    })),
  };
}

/** Attaches what the engine does not know: each category's note, snooze flag and upcoming (EXF-505). */
function withNotes(
  detail: CoreMonthDetail,
  notes: Map<string, string | null>,
  sources: readonly UpcomingSource[] = [],
): MonthDetail {
  const upcoming = upcomingByCategory(sources, detail.month);
  return {
    ...detail,
    groups: detail.groups.map((g) => ({
      ...g,
      categories: g.categories.map((c) => {
        // A credit card payment category never gets an upcoming figure.
        const u = c.kind === "credit_card_payment" ? undefined : upcoming.get(c.id);
        return {
          ...c,
          note: notes.get(c.id) ?? null,
          target_snoozed: c.target?.status === "snoozed",
          upcoming: u?.upcoming ?? 0,
          upcoming_count: u?.upcoming_count ?? 0,
          available_after_upcoming: c.available + (u?.upcoming ?? 0),
        };
      }),
    })),
  };
}

/** Plan reads accept a month up to this many years after the current month. */
export const PLAN_MONTH_YEARS = 10;
/** ...and no earlier than this fixed floor. The plan's first month would cost a D1 call, so it is not used. */
export const PLAN_MONTH_FLOOR: Month = "1970-01-01";

/**
 * The 422 message for a month before PLAN_MONTH_FLOOR or more than PLAN_MONTH_YEARS after the current month
 * (`today`, the owner's local date, else the server's UTC date); the one bound REST and MCP share.
 */
export function planMonthError(month: Month, today: string = todayUtc()): string | null {
  if (month < PLAN_MONTH_FLOOR) return `Month must not be before ${PLAN_MONTH_FLOOR.slice(0, 7)}`;
  if (month > addMonths(toMonth(today), PLAN_MONTH_YEARS * 12)) {
    return `Month must be at most ${PLAN_MONTH_YEARS} years after today`;
  }
  return null;
}

/** The month read and the schedules behind its upcoming figures, on the same single read (the Activity list). */
export async function getPlanMonthWithSources(
  env: Env,
  budgetId: string,
  month: Month,
  today: string = todayUtc(),
  view: PlanView = "all",
): Promise<{ detail: MonthDetail; sources: UpcomingSource[] }> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const input = await loadInput(db, budgetId, addMonths(month, 1), true);
  return {
    detail: viewDetail(
      withNotes(
        computeMonth({ ...input, today }, month),
        input.categoryNotes,
        input.upcomingSources,
      ),
      view,
    ),
    sources: input.upcomingSources,
  };
}

export async function getPlanMonth(
  env: Env,
  budgetId: string,
  month: Month,
  today: string = todayUtc(),
  view: PlanView = "all",
): Promise<MonthDetail> {
  return (await getPlanMonthWithSources(env, budgetId, month, today, view)).detail;
}

/** Several months on one read of the plan (no view), for Auto-Assign's history. */
export async function getPlanMonths(
  env: Env,
  budgetId: string,
  months: Month[],
  today: string = todayUtc(),
): Promise<MonthDetail[]> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const latest = months.reduce((a, b) => (a > b ? a : b));
  const input = await loadInput(db, budgetId, addMonths(latest, 1), true);
  return months.map((m) =>
    withNotes(computeMonth({ ...input, today }, m), input.categoryNotes, input.upcomingSources),
  );
}

/**
 * Totals of one month over the visible categories, or over exactly `categoryIds` (hidden ones included).
 * An id that is not an active category of the plan is a 404.
 */
export async function getMonthSummary(
  env: Env,
  budgetId: string,
  month: Month,
  categoryIds?: string[],
  today: string = todayUtc(),
  view?: PlanView,
): Promise<MonthTotals> {
  const detail = await getPlanMonth(env, budgetId, month, today);
  if (view !== undefined) {
    if (categoryIds)
      throw new HTTPException(422, { message: "Give category_ids or view, not both" });
    return viewTotals(detail, view);
  }
  if (categoryIds) {
    const known = new Set(detail.groups.flatMap((g) => g.categories.map((c) => c.id)));
    if (categoryIds.some((id) => !known.has(id))) throw new NotFound("Category");
  }
  return monthTotals(detail, categoryIds);
}

export async function listPlanMonths(
  env: Env,
  budgetId: string,
  from: Month,
  to: Month,
): Promise<MonthSummary[]> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  return computeMonths(await loadInput(db, budgetId, addMonths(to, 1)), from, to);
}

/** Facts for the navigation limits; the browser applies "today" (the person's local month). */
export async function getMonthRange(env: Env, budgetId: string): Promise<MonthRange> {
  const db = getDb(env);
  const plan = await budgetsRepo.findActive(db, budgetId);
  if (!plan) throw new NotFound("Plan");
  const f = await monthRangeRepo.monthFacts(db, budgetId);
  const candidates = [toMonth(plan.createdAt), f.firstAssigned, f.firstNote, f.firstTransaction];
  const first = candidates.filter((m): m is string => m !== null).sort()[0] as string;
  return { first_month: first, last_assigned_month: f.lastAssigned };
}
