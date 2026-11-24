import { cardTargetFields, cardTargetType } from "@budget/core/card-targets";
import { toMonth } from "@budget/core/month";
import { IsoDate } from "@budget/schema/common/dates";
import {
  CardTargetSet,
  type Target,
  TargetDelete,
  TargetSet,
  type TargetSnooze,
} from "@budget/schema/targets";
import { sql } from "drizzle-orm";
import { type Db, getDb } from "../db/client";
import type { Env } from "../env";
import { type ChangeLogEntry, changeLogInsertIf } from "../history/change-log";
import { Conflict, NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import * as snoozesRepo from "../repositories/target-snoozes";
import * as repo from "../repositories/targets";
import { PaymentLocked } from "./credit-payments";

const MAX_ATTEMPTS = 5;

/** Today's date in UTC, the same rule `currentMonth()` uses. */
export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** `kind`: the target's category kind; a payment category's target also carries its card target type. */
export function targetToApi(row: repo.TargetRow, kind: string | null = null): Target {
  return {
    ...repo.toDefinition(row),
    type: kind ? cardTargetType(repo.toDefinition(row)) : null,
    budget_id: row.budgetId,
    category_id: row.categoryId,
    created_month: toMonth(row.createdOn),
  };
}

/** Test seam: the setTarget batch with a custom change_log entry (to prove atomicity). */
export function buildSetTargetBatch(
  db: Db,
  row: repo.TargetRow,
  log: ChangeLogEntry,
  beforeUpdatedAt?: string,
) {
  return [
    changeLogInsertIf(db, log, repo.holds(db, row.budgetId, row.categoryId, beforeUpdatedAt)),
    repo.upsertIfHoldsStmt(db, row, beforeUpdatedAt),
  ] as const;
}

async function requirePlan(db: Db, budgetId: string) {
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
}

/** A target write is refused for the category's kind. The routes answer 422 with `code`. */
export class TargetRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TargetRefused";
  }
}

type Fields = Omit<repo.TargetRow, "createdOn" | "createdAt" | "updatedAt">;

/** The create-or-replace write both setters share: a replace keeps `created_on`; retried on a lost race. */
async function writeTarget(
  db: Db,
  actor: string,
  fields: Fields,
  kind: string | null,
  today: string | undefined,
): Promise<Target> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await repo.find(db, fields.budgetId, fields.categoryId);
    const now = new Date().toISOString();
    const row: repo.TargetRow = {
      ...fields,
      createdOn: before?.createdOn ?? today ?? todayUtc(),
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    };
    const result = targetToApi(row, kind);
    const [, write] = await db.batch([
      ...buildSetTargetBatch(
        db,
        row,
        {
          budgetId: fields.budgetId,
          actor,
          action: before ? "update" : "create",
          entityType: "target",
          entityId: fields.categoryId,
          before: before ? targetToApi(before, kind) : null,
          after: result,
        },
        before?.updatedAt,
      ),
    ]);
    if (write.meta.changes > 0) return result;
  }
  throw new Conflict("Target");
}

/** Creates or replaces a category's target. A replace keeps `created_on`. */
export async function setTarget(
  env: Env,
  actor: string,
  input: TargetSet,
  opts: { today?: string } = {},
): Promise<Target> {
  const v = TargetSet.parse(input);
  const today = opts.today === undefined ? undefined : IsoDate.parse(opts.today);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  const cat = await categoriesRepo.findActive(db, v.budget_id, v.category_id);
  if (!cat) throw new NotFound("Category");
  if (cat.kind !== null) {
    throw new PaymentLocked("payment_category_target");
  }
  return writeTarget(
    db,
    actor,
    {
      categoryId: v.category_id,
      budgetId: v.budget_id,
      cadence: v.cadence,
      behavior: v.behavior,
      amount: v.amount,
      dayOfWeek: v.day_of_week ?? null,
      dayOfMonth: v.day_of_month ?? null,
      dueDate: v.due_date ?? null,
      dueMonth: v.due_month ?? null,
      repeatEvery: v.repeat?.every ?? null,
      repeatUnit: v.repeat?.unit ?? null,
    },
    null,
    today,
  );
}

/** Creates or replaces the target of a credit card payment category (EXF-538). */
export async function setCardPaymentTarget(
  env: Env,
  actor: string,
  input: CardTargetSet,
  opts: { today?: string } = {},
): Promise<Target> {
  const v = CardTargetSet.parse(input);
  const today = opts.today === undefined ? undefined : IsoDate.parse(opts.today);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  const cat = await categoriesRepo.findActive(db, v.budget_id, v.category_id);
  if (!cat) throw new NotFound("Category");
  if (cat.kind === null) {
    throw new TargetRefused(
      "card_target_requires_payment_category",
      "Card payment targets are only for credit card payment categories.",
    );
  }
  const f = cardTargetFields(
    v.type,
    v.type === "card_payoff_by_date" ? { month: v.month } : { amount: v.amount },
  );
  return writeTarget(
    db,
    actor,
    {
      categoryId: v.category_id,
      budgetId: v.budget_id,
      cadence: f.cadence,
      behavior: f.behavior,
      amount: f.amount,
      dayOfWeek: null,
      dayOfMonth: null,
      dueDate: null,
      dueMonth: f.due_month,
      repeatEvery: null,
      repeatUnit: null,
    },
    cat.kind,
    today,
  );
}

export async function deleteTarget(env: Env, actor: string, input: TargetDelete): Promise<Target> {
  const v = TargetDelete.parse(input);
  const db = getDb(env);
  await requirePlan(db, v.budget_id);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await repo.find(db, v.budget_id, v.category_id);
    if (!before) throw new NotFound("Target");
    const kind = (await categoriesRepo.findActive(db, v.budget_id, v.category_id))?.kind ?? null;
    const [, del] = await db.batch([
      changeLogInsertIf(
        db,
        {
          budgetId: v.budget_id,
          actor,
          action: "delete",
          entityType: "target",
          entityId: v.category_id,
          before: targetToApi(before, kind),
          after: null,
        },
        repo.holds(db, v.budget_id, v.category_id, before.updatedAt),
      ),
      repo.deleteIfHoldsStmt(db, v.budget_id, v.category_id, before.updatedAt),
      // The target's snoozes go with it (only when the delete above changed a row).
      snoozesRepo.deleteForCategoryStmt(db, v.budget_id, v.category_id, sql`changes() > 0`),
    ]);
    if (del.meta.changes > 0) return targetToApi(before, kind);
  }
  throw new Conflict("Target");
}

/** The snooze is refused: no target, or not the owner's current month. The routes answer 422. */
export class SnoozeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnoozeRefused";
  }
}

/**
 * Snoozes or unsnoozes a category's target for a month. Only the owner's current month (`today`, default the
 * server's UTC date) and only a category with a target; asking for the state it already has writes nothing.
 */
export async function setTargetSnooze(
  env: Env,
  actor: string,
  input: { budget_id: string; month: string; category_id: string; snoozed: boolean },
  opts: { today?: string } = {},
): Promise<TargetSnooze> {
  const db = getDb(env);
  const today = opts.today === undefined ? todayUtc() : IsoDate.parse(opts.today);
  await requirePlan(db, input.budget_id);
  if (!(await categoriesRepo.findActive(db, input.budget_id, input.category_id))) {
    throw new NotFound("Category");
  }
  if (!(await repo.find(db, input.budget_id, input.category_id))) {
    throw new SnoozeRefused("This category has no target to snooze.");
  }
  if (input.month !== toMonth(today)) {
    throw new SnoozeRefused("You can only snooze targets in the current month.");
  }
  const result: TargetSnooze = {
    month: input.month,
    category_id: input.category_id,
    snoozed: input.snoozed,
  };
  const now = new Date().toISOString();
  // One batch: the log row only while the state is still what was read AND the target still exists; the
  // write only if that row was written. A concurrent identical request or a target delete logs nothing.
  const [log] = await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId: input.budget_id,
        actor,
        action: "update",
        entityType: "target_snooze",
        entityId: `${input.category_id}:${input.month}`,
        before: { ...result, snoozed: !input.snoozed },
        after: result,
      },
      snoozesRepo.stateHolds(db, input.budget_id, input.category_id, input.month, input.snoozed),
    ),
    input.snoozed
      ? snoozesRepo.insertIfStmt(
          db,
          {
            budgetId: input.budget_id,
            categoryId: input.category_id,
            month: input.month,
            createdAt: now,
          },
          sql`changes() > 0`,
        )
      : snoozesRepo.deleteStmt(
          db,
          input.budget_id,
          input.category_id,
          input.month,
          sql`changes() > 0`,
        ),
  ]);
  if (log.meta.changes === 0 && !(await repo.find(db, input.budget_id, input.category_id))) {
    throw new SnoozeRefused("This category has no target to snooze.");
  }
  return result;
}
