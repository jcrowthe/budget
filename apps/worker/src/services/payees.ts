import { type CategoryValue, effectiveDefault } from "@budget/schema/payee-category";
import {
  compareNames,
  PAYEE_ERRORS,
  PAYEE_TRANSACTIONS_LIMIT,
  type Payee,
  type PayeeDeleted,
  type PayeeRecentTransaction,
  type PayeeSystem,
  type PayeeTransaction,
  type PayeeUpdate,
} from "@budget/schema/payees";
import { checkRuleText, foldRuleText } from "@budget/schema/rename-rules";
import {
  TRANSFER_PAYEE_PREFIX,
  transferPayeeId,
  transferPayeeName,
} from "@budget/schema/transfers";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { type Db as DbT, getDb } from "../db/client";
import { accounts as accountsTable } from "../db/schema/accounts";
import { changeLog } from "../db/schema/change-log";
import { payeeRenameRules } from "../db/schema/payee-rename-rules";
import { payees as payeesTable } from "../db/schema/payees";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import { allOf, type LogBase, whenQuery } from "../repositories/guards";
import * as categoryRepo from "../repositories/payee-category";
import * as deleteLog from "../repositories/payee-delete-log";
import * as rulesRepo from "../repositories/payee-rename-rules";
import * as payeesRepo from "../repositories/payees";
import * as scheduledRepo from "../repositories/scheduled-transactions";
import * as transactionsRepo from "../repositories/transactions";
import { TransactionRefused } from "./transactions";

type Db = ReturnType<typeof getDb>;

const RTA: CategoryValue = { category_id: null, inflow_to_ready_to_assign: true };

export function payeeToApi(
  row: payeesRepo.PayeeRow &
    Partial<
      Pick<
        payeesRepo.PayeeListRow,
        | "transactionCount"
        | "scheduledCount"
        | "hasRules"
        | "fixedLiveCategoryId"
        | "historyDefault"
      >
    >,
  lastCategoryId: string | null = null,
  lastInflow = false,
): Payee {
  // System payees are set by the app: they never suggest a category.
  const ordinary = row.system === null;
  const mode = ordinary ? (row.categoryMode ?? "history") : "history";
  const fixedRta = ordinary && (row.fixedInflowToReadyToAssign ?? false);
  const fixedValue: CategoryValue | null = fixedRta
    ? RTA
    : row.fixedLiveCategoryId
      ? { category_id: row.fixedLiveCategoryId, inflow_to_ready_to_assign: false }
      : null;
  const suggestion = ordinary
    ? effectiveDefault(mode, fixedValue, row.historyDefault ?? null)
    : null;
  return {
    id: row.id,
    name: row.name,
    hidden: row.hidden,
    system: row.system,
    last_category_id: lastCategoryId,
    last_inflow_to_ready_to_assign: lastInflow,
    category_mode: mode,
    fixed_category_id: ordinary ? (row.fixedCategoryId ?? null) : null,
    fixed_inflow_to_ready_to_assign: fixedRta,
    default_category_id: suggestion?.category_id ?? null,
    default_inflow_to_ready_to_assign: suggestion?.inflow_to_ready_to_assign ?? false,
    transfer_account_id: null,
    transaction_count: row.transactionCount ?? 0,
    scheduled_count: row.scheduledCount ?? 0,
    has_rules: row.hasRules ?? false,
  };
}

export async function listPayees(
  env: Env,
  budgetId: string,
  opts: { q?: string; includeHidden?: boolean } = {},
): Promise<Payee[]> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const rows = await payeesRepo.listForPlan(db, budgetId, {
    includeHidden: opts.includeHidden ?? false,
    counts: true,
  });
  // The transfer entries stand for the plan's open accounts; they are derived here, never stored.
  // One D1 call for the open accounts and the transfer entries that have rules.
  const [accounts, ruledRows] = await db.batch([
    db
      .select({ id: accountsTable.id, name: accountsTable.name })
      .from(accountsTable)
      .where(
        and(
          eq(accountsTable.budgetId, budgetId),
          isNull(accountsTable.deletedAt),
          eq(accountsTable.closed, false),
        ),
      )
      .orderBy(asc(accountsTable.sortOrder), asc(accountsTable.id)),
    rulesRepo.transferIdsWithRulesQuery(db, budgetId),
  ]);
  const ruled = new Set(ruledRows.map((r) => r.id));
  const transfers: Payee[] = accounts.map((a) => ({
    id: transferPayeeId(a.id),
    name: transferPayeeName(a.name),
    hidden: false,
    system: null,
    last_category_id: null,
    last_inflow_to_ready_to_assign: false,
    category_mode: "history",
    fixed_category_id: null,
    fixed_inflow_to_ready_to_assign: false,
    default_category_id: null,
    default_inflow_to_ready_to_assign: false,
    transfer_account_id: a.id,
    transaction_count: 0,
    scheduled_count: 0,
    has_rules: ruled.has(transferPayeeId(a.id)),
  }));
  const needle = opts.q?.toLowerCase() ?? "";
  return [
    ...rows.map((r) => payeeToApi(r, r.lastCategoryId, r.lastInflowToReadyToAssign)),
    ...transfers,
  ]
    .filter((r) => needle === "" || r.name.toLowerCase().includes(needle))
    .sort(compareNames);
}

export type ResolvedPayee = {
  payeeId: string | null;
  name: string | null;
  system: PayeeSystem | null;
  create?: payeesRepo.PayeeRow;
};

/**
 * The payee a request names: undefined when it names none. `payee_id` must be a payee of the plan (a system
 * one only when it is already the row's), `payee_name` matches an ordinary payee exactly or is created.
 */
export async function resolvePayee(
  db: Db,
  budgetId: string,
  input: { payee_id?: string | null; payee_name?: string | null },
  current?: string | null,
): Promise<ResolvedPayee | undefined> {
  const hasId = input.payee_id !== undefined;
  const hasName = input.payee_name !== undefined;
  if (hasId && hasName) {
    throw new TransactionRefused(
      422,
      "unprocessable_entity",
      "Give payee_id or payee_name, not both",
    );
  }
  if (hasId) {
    if (input.payee_id?.startsWith(TRANSFER_PAYEE_PREFIX)) {
      throw new TransactionRefused(
        422,
        "unprocessable_entity",
        "Use transfer_account_id for a transfer",
      );
    }
    if (input.payee_id === null) return { payeeId: null, name: null, system: null };
    const p = await payeesRepo.findActive(db, budgetId, input.payee_id as string);
    if (!p)
      throw new TransactionRefused(422, "unprocessable_entity", "Payee not found in this plan");
    if (p.system && p.id !== current) {
      throw new TransactionRefused(422, "unprocessable_entity", "System payees are set by the app");
    }
    return { payeeId: p.id, name: p.name, system: p.system };
  }
  if (!hasName) return undefined;
  const name = input.payee_name?.trim() ?? "";
  if (name === "") return { payeeId: null, name: null, system: null };
  const found = await payeesRepo.findByName(db, budgetId, name);
  if (found) return { payeeId: found.id, name: found.name, system: null };
  const now = new Date().toISOString();
  const create: payeesRepo.PayeeRow = {
    id: crypto.randomUUID(),
    budgetId,
    name,
    hidden: false,
    system: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return { payeeId: create.id, name, system: null, create };
}

export class PayeeRefused extends Error {
  constructor(
    public status: 403 | 409 | 422,
    public code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "PayeeRefused";
  }
}

/** A credit card payment category belongs to its card's payments, not to a payee. */
const FIXED_PAYMENT_CATEGORY = "A credit card payment category can't be a payee's fixed category";
const forbidden = (m: string) => new PayeeRefused(403, "forbidden", m);
const unprocessable = (m: string) => new PayeeRefused(422, "unprocessable_entity", m);

export async function requirePlan(db: DbT, budgetId: string) {
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
}

/** The payee a path names: a transfer entry or a system payee is refused (403), a missing one is 404. */
export async function pathPayee(db: DbT, budgetId: string, payeeId: string, withCounts: boolean) {
  if (payeeId.startsWith(TRANSFER_PAYEE_PREFIX)) throw forbidden(PAYEE_ERRORS.transfer);
  const [row] = await payeesRepo.listForPlan(db, budgetId, {
    includeHidden: true,
    counts: withCounts,
    ids: [payeeId],
  });
  if (!row) throw new NotFound("Payee");
  if (row.system) throw forbidden(PAYEE_ERRORS.system);
  return row;
}

const hasCategoryField = (i: PayeeUpdate) =>
  i.category_mode !== undefined ||
  i.fixed_category_id !== undefined ||
  i.fixed_inflow_to_ready_to_assign !== undefined;

export interface PayeeUpdatePlan {
  budgetId: string;
  actor: string;
  now: string;
  row: payeesRepo.PayeeListRow;
  name: string;
  hidden: boolean;
  mode: payeesRepo.PayeeFullRow["categoryMode"];
  fixedCategoryId: string | null;
  fixedRta: boolean;
  /** The request named a category field: the log row and the update carry the category columns. */
  namesCategory: boolean;
  /** The fixed category the request sets, which must still be live when the batch runs. */
  liveFixed?: string | null;
  /** Statements that go first (a renaming rule). */
  learn: BatchItem<"sqlite">[];
}

/** The statements of one payee update: `learn`, the history row, then the update itself (last: it reads success). */
export function buildPayeeUpdateBatch(db: DbT, p: PayeeUpdatePlan): BatchItem<"sqlite">[] {
  const { budgetId, row } = p;
  const same = payeesRepo.updateGuardSql(budgetId, row.id, row, p.liveFixed ?? null);
  const shape = (v: {
    name: string;
    hidden: boolean;
    mode: string;
    fixedCategoryId: string | null;
    fixedRta: boolean;
  }) => ({
    id: row.id,
    name: v.name,
    hidden: v.hidden,
    ...(p.namesCategory
      ? {
          category_mode: v.mode,
          fixed_category_id: v.fixedCategoryId,
          fixed_inflow_to_ready_to_assign: v.fixedRta,
        }
      : {}),
  });
  return [
    ...p.learn,
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor: p.actor,
        action: "update",
        entityType: "payee",
        entityId: row.id,
        before: shape({
          name: row.name,
          hidden: row.hidden,
          mode: row.categoryMode,
          fixedCategoryId: row.fixedCategoryId,
          fixedRta: row.fixedInflowToReadyToAssign,
        }),
        after: shape(p),
      },
      whenQuery(db, same),
    ),
    payeesRepo.updateStmt(
      db,
      budgetId,
      row.id,
      {
        name: p.name,
        hidden: p.hidden,
        ...(p.namesCategory
          ? {
              categoryMode: p.mode,
              fixedCategoryId: p.fixedCategoryId,
              fixedInflowToReadyToAssign: p.fixedRta,
            }
          : {}),
      },
      p.now,
      row,
      p.liveFixed ?? null,
    ),
  ] as BatchItem<"sqlite">[];
}

export async function updatePayee(
  env: Env,
  actor: string,
  budgetId: string,
  payeeId: string,
  input: PayeeUpdate,
): Promise<Payee> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const row = await pathPayee(db, budgetId, payeeId, true);
  const namesCategory = hasCategoryField(input);
  if (input.name === undefined && input.hidden === undefined && !namesCategory) {
    throw unprocessable(PAYEE_ERRORS.noField);
  }
  if (input.fixed_category_id && input.fixed_inflow_to_ready_to_assign === true) {
    throw unprocessable(PAYEE_ERRORS.fixedBoth);
  }
  const name = input.name === undefined ? row.name : input.name.trim();
  if (name === "") throw unprocessable(PAYEE_ERRORS.empty);
  // The fixed choice after the request: a given category clears Ready to Assign and the other way round.
  let fixedCategoryId = row.fixedCategoryId;
  let fixedRta = row.fixedInflowToReadyToAssign;
  if (input.fixed_category_id !== undefined) {
    fixedCategoryId = input.fixed_category_id;
    if (fixedCategoryId !== null) fixedRta = false;
  }
  if (input.fixed_inflow_to_ready_to_assign !== undefined) {
    fixedRta = input.fixed_inflow_to_ready_to_assign;
    if (fixedRta) fixedCategoryId = null;
  }
  const mode = input.category_mode ?? row.categoryMode;
  if (mode === "fixed") {
    if (fixedCategoryId === null && !fixedRta) throw unprocessable(PAYEE_ERRORS.fixedNeedsValue);
    // A stored fixed category must still be live; a given one is checked below.
    if (
      input.fixed_category_id === undefined &&
      fixedCategoryId !== null &&
      !row.fixedLiveCategoryId
    )
      throw unprocessable(PAYEE_ERRORS.fixedNeedsValue);
  }
  const givenCategory = input.fixed_category_id ?? null;
  // One read call for both checks: the duplicate name and the given category.
  const renamed = name !== row.name;
  if (renamed || givenCategory !== null) {
    const reads: [unknown?, unknown?] = [];
    if (renamed) reads.push(payeesRepo.findByNameQuery(db, budgetId, name));
    if (givenCategory !== null)
      reads.push(categoryRepo.liveCategoryKindQuery(db, budgetId, givenCategory));
    const res = (await db.batch(reads as never)) as unknown as unknown[][];
    if (renamed) {
      const other = (res[0] as payeesRepo.PayeeRow[])[0];
      if (other && other.id !== row.id)
        throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.duplicate);
    }
    if (givenCategory !== null) {
      const [found] = res[res.length - 1] as { payment: number }[];
      if (!found) throw unprocessable(PAYEE_ERRORS.categoryUnknown);
      if (Number(found.payment) === 1) throw unprocessable(FIXED_PAYMENT_CATEGORY);
    }
  }
  const hidden = input.hidden ?? row.hidden;
  const fixedLive =
    fixedCategoryId === null
      ? null
      : input.fixed_category_id === undefined
        ? row.fixedLiveCategoryId
        : fixedCategoryId;
  const after = {
    ...row,
    name,
    hidden,
    categoryMode: mode,
    fixedCategoryId,
    fixedInflowToReadyToAssign: fixedRta,
    fixedLiveCategoryId: fixedLive,
  };
  if (
    name === row.name &&
    hidden === row.hidden &&
    mode === row.categoryMode &&
    fixedCategoryId === row.fixedCategoryId &&
    fixedRta === row.fixedInflowToReadyToAssign
  )
    return payeeToApi(row, row.lastCategoryId, row.lastInflowToReadyToAssign);
  const now = new Date().toISOString();
  const same = payeesRepo.unchangedSql(budgetId, row.id, row);
  // A rename of a payee whose old name came from a bank import adds the rule `is <old name>` (before the update).
  // The import's name may differ from the payee's in case (the sync title-cases ALL CAPS): SQL's lower() knows only
  // ASCII, so a name with other letters still matches exactly.
  const ruleId = crypto.randomUUID();
  // The rule's text is the bank's own (an imported row of this payee whose folded name is the payee's), as imported.
  const importedText = sql`(select trim(t.import_payee_name) from transactions t where t.budget_id = ${budgetId} and t.payee_id = ${row.id} and t.deleted_at is null and (t.import_payee_name = ${row.name} or lower(trim(t.import_payee_name)) = ${foldRuleText(row.name)}) order by (t.import_payee_name = ${row.name}) desc, t.rowid limit 1)`;
  const learn =
    name !== row.name && checkRuleText(row.name).ok
      ? [
          ...rulesRepo.addIfMissingStmts(
            db,
            { budgetId, actor, action: "create", entityType: "payee_rename_rule", createdAt: now },
            {
              id: ruleId,
              budgetId,
              payeeId: row.id,
              kind: "is",
              text: row.name.trim(),
              matchText: foldRuleText(row.name),
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            },
            sql`${same} and exists (select 1 from transactions t where t.budget_id = ${budgetId} and t.payee_id = ${row.id} and t.deleted_at is null and (t.import_payee_name = ${row.name} or lower(trim(t.import_payee_name)) = ${foldRuleText(row.name)}))`,
          ),
          // Both are no-ops when the rule was not added (its id is new).
          db
            .update(payeeRenameRules)
            .set({ text: sql`coalesce(${importedText}, text)` })
            .where(eq(payeeRenameRules.id, ruleId)),
          db
            .update(changeLog)
            .set({
              afterJson: sql`json_set(after_json, '$.text', coalesce(${importedText}, json_extract(after_json, '$.text')))`,
            })
            .where(
              and(eq(changeLog.entityType, "payee_rename_rule"), eq(changeLog.entityId, ruleId)),
            ),
        ]
      : [];
  let ruleAdded = false;
  try {
    const batch = buildPayeeUpdateBatch(db, {
      budgetId,
      actor,
      now,
      row,
      name,
      hidden,
      mode,
      fixedCategoryId,
      fixedRta,
      namesCategory,
      liveFixed: givenCategory,
      learn: learn as BatchItem<"sqlite">[],
    });
    const res = await db.batch(batch as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    // The guard failed (a rename, hide or delete got there first): nothing was written.
    if (((res[res.length - 1] as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) {
      throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.race);
    }
    // The rule's insert is the second statement of `learn` (then the two that set its text as imported).
    if (learn.length > 0)
      ruleAdded = ((res[1] as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
  } catch (e) {
    if (payeesRepo.isUniqueViolation(e))
      throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.duplicate);
    throw e;
  }
  return payeeToApi(
    { ...after, hasRules: row.hasRules || ruleAdded, updatedAt: now },
    row.lastCategoryId,
    row.lastInflowToReadyToAssign,
  );
}

export type PayeeAction = "hide" | "unhide" | "delete";

export interface PayeeDeletePlan {
  budgetId: string;
  actor: string;
  now: string;
  ids: string[];
  replacementId: string | null;
  counts: Record<string, { t: number; s: number }>;
}

/** The statements of one delete, eight whatever the rows. A test appends a failing statement to prove atomicity. */
export function buildPayeeDeleteBatch(db: DbT, p: PayeeDeletePlan): BatchItem<"sqlite">[] {
  const { budgetId, ids, replacementId } = p;
  const guard = allOf(
    payeesRepo.liveOrdinaryCountSql(budgetId, ids),
    replacementId ? payeesRepo.liveOrdinarySql(budgetId, replacementId) : null,
  );
  const base: LogBase = {
    budgetId,
    actor: p.actor,
    action: "delete",
    entityType: "payee",
    createdAt: p.now,
  };
  return [
    payeesRepo.logDeleteStmt(db, base, budgetId, ids, replacementId, p.counts, guard),
    deleteLog.logTransactionMovesStmt(db, base, budgetId, ids, replacementId, guard),
    deleteLog.logScheduledMovesStmt(db, base, budgetId, ids, replacementId, guard),
    transactionsRepo.movePayeeStmt(db, budgetId, ids, replacementId, p.now, guard),
    scheduledRepo.movePayeeStmt(
      db,
      budgetId,
      ids,
      replacementId,
      p.now,
      crypto.randomUUID(),
      guard,
    ),
    ...rulesRepo.removeForPayeesStmts(db, base, budgetId, ids, guard),
    payeesRepo.softDeleteStmt(db, budgetId, ids, p.now, guard),
  ];
}

export interface PayeeCombinePlan {
  budgetId: string;
  actor: string;
  now: string;
  /** The payee that stays, as read (the batch fails if it was renamed since). */
  survivor: payeesRepo.PayeeListRow;
  /** The payees that go: their rows and rules move to the survivor. */
  mergedIds: string[];
  /** The survivor's name after the combine (trimmed). */
  name: string;
  counts: Record<string, { t: number; s: number }>;
}

/** Where the rule statements start in a combine batch: the soft delete is `+1`, the move `+3`. */
const COMBINE_RULES_AT = 8;

/**
 * The statements of one combine, fourteen whatever the payees, rules or rows: a first check that every payee read is still live (the rename is not guarded by the others' count), the survivor's rename (two no-op
 * statements when its name stays), the delete's history rows and moves of EXF-882 with the survivor as the
 * replacement, the rules' move, the merged payees' soft delete and a closing check. A test appends a failing
 * statement to prove atomicity.
 */
export function buildPayeeCombineBatch(db: DbT, p: PayeeCombinePlan): BatchItem<"sqlite">[] {
  const { budgetId, mergedIds, survivor } = p;
  const guard = payeesRepo.liveOrdinaryCountSql(budgetId, [survivor.id, ...mergedIds]);
  const base: LogBase = {
    budgetId,
    actor: p.actor,
    action: "delete",
    entityType: "payee",
    createdAt: p.now,
  };
  const renamed = p.name !== survivor.name;
  // The rename goes first, so that the moved rows read the new name. It carries the unchanged-payee guard.
  const rename: BatchItem<"sqlite">[] = renamed
    ? buildPayeeUpdateBatch(db, {
        budgetId,
        actor: p.actor,
        now: p.now,
        row: survivor,
        name: p.name,
        hidden: survivor.hidden,
        mode: survivor.categoryMode,
        fixedCategoryId: survivor.fixedCategoryId,
        fixedRta: survivor.fixedInflowToReadyToAssign,
        namesCategory: false,
        learn: [],
      })
    : [
        changeLogInsertIf(
          db,
          {
            budgetId,
            actor: p.actor,
            action: "update",
            entityType: "payee",
            entityId: survivor.id,
            before: null,
            after: null,
          },
          whenQuery(db, sql`0`),
        ),
        db.update(payeesTable).set({ updatedAt: p.now }).where(sql`0`),
      ];
  return [
    ...payeesRepo.livePayeesCheck(db, budgetId, [survivor.id, ...mergedIds]),
    ...rename,
    payeesRepo.logDeleteStmt(db, base, budgetId, mergedIds, survivor.id, p.counts, guard),
    deleteLog.logTransactionMovesStmt(db, base, budgetId, mergedIds, survivor.id, guard),
    deleteLog.logScheduledMovesStmt(db, base, budgetId, mergedIds, survivor.id, guard),
    transactionsRepo.movePayeeStmt(db, budgetId, mergedIds, survivor.id, p.now, guard),
    scheduledRepo.movePayeeStmt(
      db,
      budgetId,
      mergedIds,
      survivor.id,
      p.now,
      crypto.randomUUID(),
      guard,
    ),
    ...rulesRepo.moveForPayeesStmts(db, base, budgetId, mergedIds, survivor.id, p.now, guard),
    payeesRepo.softDeleteStmt(db, budgetId, mergedIds, p.now, guard),
    payeesRepo.combineCheckStmt(db, budgetId, survivor.id, p.name, mergedIds),
  ] as BatchItem<"sqlite">[];
}

export interface PayeeCombineResult {
  payee: Payee;
  merged: PayeeDeleted[];
  rules_moved: number;
  rules_dropped: number;
}

/**
 * Combine and Rename (EXF-512): `ids` become one payee called `name`. The survivor is `targetId`, else the selected
 * payee already called `name`, else the first id. Its transactions, schedules and rules take the others' (rules
 * deduped by kind and text); the others are deleted. Four D1 calls whatever the rows.
 */
export async function combinePayees(
  env: Env,
  actor: string,
  budgetId: string,
  input: { ids: string[]; name: string; targetId?: string },
): Promise<PayeeCombineResult> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const ids = [...new Set(input.ids)];
  if (ids.length < 2) throw unprocessable(PAYEE_ERRORS.combineTooFew);
  const named = [...ids, ...(input.targetId ? [input.targetId] : [])];
  if (named.some((i) => i.startsWith(TRANSFER_PAYEE_PREFIX)))
    throw unprocessable(PAYEE_ERRORS.combineTransfer);
  if (input.targetId !== undefined && !ids.includes(input.targetId))
    throw unprocessable(PAYEE_ERRORS.combineTarget);
  const name = input.name.trim();
  // One read call: the selected payees (with counts) and the live payee that already has the name.
  const [found, byName] = await db.batch([
    payeesRepo.listForPlanQuery(db, budgetId, { includeHidden: true, counts: true, ids }),
    payeesRepo.findByNameQuery(db, budgetId, name),
  ]);
  const rows = payeesRepo.listRowsOf(found);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    if (!byId.has(id)) throw unprocessable(`${PAYEE_ERRORS.unknown}: ${id}`);
  }
  if (rows.some((r) => r.system)) throw unprocessable(PAYEE_ERRORS.combineSystem);
  if (name === "") throw unprocessable(PAYEE_ERRORS.empty);
  const same = byName[0];
  const survivorId = input.targetId ?? (same && byId.has(same.id) ? same.id : ids[0]);
  const survivor = byId.get(survivorId as string) as payeesRepo.PayeeListRow;
  if (same && !byId.has(same.id)) throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.duplicate);
  if (same && same.id !== survivor.id)
    throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.combineNameInSelection);
  const mergedRows = ids
    .filter((i) => i !== survivor.id)
    .map((i) => byId.get(i) as payeesRepo.PayeeListRow);
  const mergedIds = mergedRows.map((r) => r.id);
  const counts = Object.fromEntries(
    mergedRows.map((r) => [r.id, { t: r.transactionCount, s: r.scheduledCount }]),
  );
  const batch = buildPayeeCombineBatch(db, {
    budgetId,
    actor,
    now: new Date().toISOString(),
    survivor,
    mergedIds,
    name,
    counts,
  });
  let res: unknown[];
  try {
    res = await db.batch(batch as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (e) {
    // The closing check failed (a rename or delete got there first): nothing was written.
    if (payeesRepo.isPayeeGone(e)) throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.race);
    if (payeesRepo.isUniqueViolation(e))
      throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.duplicate);
    throw e;
  }
  const changes = (i: number) => (res[i] as { meta?: { changes?: number } }).meta?.changes ?? 0;
  const [after] = await payeesRepo.listForPlan(db, budgetId, {
    includeHidden: true,
    counts: true,
    ids: [survivor.id],
  });
  return {
    payee: payeeToApi(
      after as payeesRepo.PayeeListRow,
      after?.lastCategoryId,
      after?.lastInflowToReadyToAssign,
    ),
    merged: mergedRows.map((r) => ({
      id: r.id,
      name: r.name,
      replacement_payee_id: survivor.id,
      transactions_moved: r.transactionCount,
      scheduled_moved: r.scheduledCount,
    })),
    rules_moved: changes(COMBINE_RULES_AT + 3),
    rules_dropped: changes(COMBINE_RULES_AT + 1),
  };
}

/** Hide, unhide or delete several payees at once (one is the same with one id). */
export async function applyToPayees(
  env: Env,
  actor: string,
  budgetId: string,
  input: { ids: string[]; action: PayeeAction; replacementId?: string | null },
): Promise<{ payees: Payee[]; deleted: PayeeDeleted[] }> {
  const db = getDb(env);
  const ids = [...new Set(input.ids)];
  await requirePlan(db, budgetId);
  if (ids.some((i) => i.startsWith(TRANSFER_PAYEE_PREFIX))) throw forbidden(PAYEE_ERRORS.transfer);
  const rows = await payeesRepo.listForPlan(db, budgetId, {
    includeHidden: true,
    counts: true,
    ids,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    if (!byId.has(id)) throw unprocessable(`${PAYEE_ERRORS.unknown}: ${id}`);
  }
  if (rows.some((r) => r.system)) throw forbidden(PAYEE_ERRORS.system);
  const replacementId = input.replacementId ?? null;
  if (replacementId !== null) {
    if (input.action !== "delete") throw unprocessable(PAYEE_ERRORS.replacementOnlyDelete);
    if (replacementId.startsWith(TRANSFER_PAYEE_PREFIX))
      throw unprocessable(PAYEE_ERRORS.replacement);
    if (ids.includes(replacementId)) throw unprocessable(PAYEE_ERRORS.replaceSelf);
    const rep = await payeesRepo.findActive(db, budgetId, replacementId);
    if (!rep || rep.system) throw unprocessable(PAYEE_ERRORS.replacement);
  }
  const now = new Date().toISOString();
  if (input.action === "delete") {
    const counts = Object.fromEntries(
      rows.map((r) => [r.id, { t: r.transactionCount, s: r.scheduledCount }]),
    );
    const batch = buildPayeeDeleteBatch(db, { budgetId, actor, now, ids, replacementId, counts });
    // The moved rows are the replacement's now: its stored default follows (same batch, no extra call).
    const recompute = replacementId
      ? categoryRepo.recomputeDefaultsStmt(db, budgetId, [replacementId])
      : null;
    const res = await db.batch([...batch, ...(recompute ? [recompute] : [])] as [
      BatchItem<"sqlite">,
      ...BatchItem<"sqlite">[],
    ]);
    const last = res[batch.length - 1] as { meta?: { changes?: number } };
    if ((last.meta?.changes ?? 0) < ids.length)
      throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.race);
    return {
      payees: [],
      deleted: rows.map((r) => ({
        id: r.id,
        name: r.name,
        replacement_payee_id: replacementId,
        transactions_moved: r.transactionCount,
        scheduled_moved: r.scheduledCount,
      })),
    };
  }
  const hidden = input.action === "hide";
  const changing = rows.filter((r) => r.hidden !== hidden);
  if (changing.length > 0) {
    const guard = payeesRepo.liveOrdinaryCountSql(budgetId, ids);
    const base: LogBase = {
      budgetId,
      actor,
      action: "update",
      entityType: "payee",
      createdAt: now,
    };
    const res = await db.batch([
      payeesRepo.logHiddenStmt(db, base, budgetId, ids, hidden, guard),
      payeesRepo.setHiddenStmt(db, budgetId, ids, hidden, now, guard),
    ]);
    const done = (res[1] as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (done < changing.length) throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.race);
  }
  return {
    payees: rows.map((r) =>
      payeeToApi({ ...r, hidden }, r.lastCategoryId, r.lastInflowToReadyToAssign),
    ),
    deleted: [],
  };
}

export async function deletePayee(
  env: Env,
  actor: string,
  budgetId: string,
  payeeId: string,
  replacementId: string | null,
): Promise<PayeeDeleted> {
  const { deleted } = await applyToPayees(env, actor, budgetId, {
    ids: [payeeId],
    action: "delete",
    replacementId,
  }).catch((e) => {
    if (
      e instanceof PayeeRefused &&
      e.status === 422 &&
      e.message.startsWith(PAYEE_ERRORS.unknown)
    ) {
      throw new NotFound("Payee");
    }
    throw e;
  });
  return deleted[0] as PayeeDeleted;
}

/** A payee's live transactions and scheduled transactions, newest first, cut at the popover's limit. */
export function listPayeeTransactions(env: Env, budgetId: string, payeeId: string) {
  return listPayeesTransactions(env, budgetId, [payeeId]);
}

/**
 * The same for several payees at once (the several-selected `Show N Transactions`): the same four D1 calls however
 * many payees. A transfer entry or system payee is refused (403), an unknown or deleted one is a 404.
 */
export async function listPayeesTransactions(
  env: Env,
  budgetId: string,
  payeeIds: readonly string[],
): Promise<{ transactions: PayeeTransaction[]; total_count: number }> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const ids = [...new Set(payeeIds)];
  if (ids.length === 0) throw new PayeeRefused(422, "unprocessable_entity", PAYEE_ERRORS.noPayees);
  if (ids.some((i) => i.startsWith(TRANSFER_PAYEE_PREFIX))) throw forbidden(PAYEE_ERRORS.transfer);
  const rows = await payeesRepo.findActiveMany(db, budgetId, ids);
  if (rows.length !== ids.length) throw new NotFound("Payee");
  if (rows.some((r) => r.system)) throw forbidden(PAYEE_ERRORS.system);
  const [real, sched] = await Promise.all([
    payeesRepo.transactionsOf(db, budgetId, ids, PAYEE_TRANSACTIONS_LIMIT),
    payeesRepo.scheduledOf(db, budgetId, ids, PAYEE_TRANSACTIONS_LIMIT),
  ]);
  const tag = (kind: PayeeTransaction["kind"]) => (r: payeesRepo.PayeeTransactionRow) => ({
    created: r.created_at,
    row: {
      id: r.id,
      kind,
      account_id: r.account_id,
      account_name: r.account_name,
      payee_name: r.payee_name,
      date: r.date,
      category_id: r.category_id,
      category_name: r.category_name,
      inflow_to_ready_to_assign: Number(r.inflow) === 1,
      is_split: Number(r.is_split) === 1,
      memo: r.memo,
      amount: r.amount,
    } satisfies PayeeTransaction,
  });
  const merged = [...real.map(tag("transaction")), ...sched.map(tag("scheduled"))].sort((a, b) =>
    a.row.date < b.row.date
      ? 1
      : a.row.date > b.row.date
        ? -1
        : a.created < b.created
          ? 1
          : a.created > b.created
            ? -1
            : a.row.id < b.row.id
              ? -1
              : 1,
  );
  return {
    transactions: merged.slice(0, PAYEE_TRANSACTIONS_LIMIT).map((m) => m.row),
    total_count: Number(real[0]?.total ?? 0) + Number(sched[0]?.total ?? 0),
  };
}

/** A payee's last counted transactions (see docs/payee-category-design.md), newest first. Three D1 calls. */
export async function listPayeeRecentTransactions(
  env: Env,
  budgetId: string,
  payeeId: string,
  limit: number,
): Promise<{ transactions: PayeeRecentTransaction[] }> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  if (payeeId.startsWith(TRANSFER_PAYEE_PREFIX)) throw forbidden(PAYEE_ERRORS.transfer);
  const row = await payeesRepo.findActive(db, budgetId, payeeId);
  if (!row) throw new NotFound("Payee");
  if (row.system) throw forbidden(PAYEE_ERRORS.system);
  const rows = await categoryRepo.recentCountedQuery(db, budgetId, payeeId, limit);
  return {
    transactions: rows.map((r) => ({
      id: r.id,
      account_id: r.account_id,
      date: r.date,
      category_id: r.category_id,
      category_name: r.category_name,
      category_group_name: r.category_group_name,
      inflow_to_ready_to_assign: Number(r.inflow) === 1,
      amount: r.amount,
    })),
  };
}
