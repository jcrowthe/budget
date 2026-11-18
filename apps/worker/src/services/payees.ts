import {
  compareNames,
  PAYEE_ERRORS,
  PAYEE_TRANSACTIONS_LIMIT,
  type Payee,
  type PayeeDeleted,
  type PayeeSystem,
  type PayeeTransaction,
} from "@budget/schema/payees";
import { checkRuleText, foldRuleText } from "@budget/schema/rename-rules";
import {
  TRANSFER_PAYEE_PREFIX,
  transferPayeeId,
  transferPayeeName,
} from "@budget/schema/transfers";
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { type Db as DbT, getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import { allOf, type LogBase, whenQuery } from "../repositories/guards";
import * as rulesRepo from "../repositories/payee-rename-rules";
import * as payeesRepo from "../repositories/payees";
import * as scheduledRepo from "../repositories/scheduled-transactions";
import * as transactionsRepo from "../repositories/transactions";
import { TransactionRefused } from "./transactions";

type Db = ReturnType<typeof getDb>;

export function payeeToApi(
  row: payeesRepo.PayeeRow &
    Partial<Pick<payeesRepo.PayeeListRow, "transactionCount" | "scheduledCount" | "hasRules">>,
  lastCategoryId: string | null = null,
  lastInflow = false,
): Payee {
  return {
    id: row.id,
    name: row.name,
    hidden: row.hidden,
    system: row.system,
    last_category_id: lastCategoryId,
    last_inflow_to_ready_to_assign: lastInflow,
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
  const accounts = await accountsRepo.list(db, budgetId, { includeClosed: false });
  const transfers: Payee[] = accounts.map((a) => ({
    id: transferPayeeId(a.id),
    name: transferPayeeName(a.name),
    hidden: false,
    system: null,
    last_category_id: null,
    last_inflow_to_ready_to_assign: false,
    transfer_account_id: a.id,
    transaction_count: 0,
    scheduled_count: 0,
    has_rules: false,
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

export async function updatePayee(
  env: Env,
  actor: string,
  budgetId: string,
  payeeId: string,
  input: { name?: string; hidden?: boolean },
): Promise<Payee> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  const row = await pathPayee(db, budgetId, payeeId, true);
  if (input.name === undefined && input.hidden === undefined) {
    throw unprocessable(PAYEE_ERRORS.noField);
  }
  const name = input.name === undefined ? row.name : input.name.trim();
  if (name === "") throw unprocessable(PAYEE_ERRORS.empty);
  if (name !== row.name) {
    const other = await payeesRepo.findByName(db, budgetId, name);
    if (other && other.id !== row.id)
      throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.duplicate);
  }
  const hidden = input.hidden ?? row.hidden;
  const after = { ...row, name, hidden };
  if (name === row.name && hidden === row.hidden)
    return payeeToApi(row, row.lastCategoryId, row.lastInflowToReadyToAssign);
  const now = new Date().toISOString();
  const same = payeesRepo.unchangedSql(budgetId, row.id, row);
  // A rename of a payee whose old name came from a bank import adds the rule `is <old name>` (before the update).
  const learn =
    name !== row.name && checkRuleText(row.name).ok
      ? rulesRepo.addIfMissingStmts(
          db,
          { budgetId, actor, action: "create", entityType: "payee_rename_rule", createdAt: now },
          {
            id: crypto.randomUUID(),
            budgetId,
            payeeId: row.id,
            kind: "is",
            text: row.name.trim(),
            matchText: foldRuleText(row.name),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
          sql`${same} and exists (select 1 from transactions t where t.budget_id = ${budgetId} and t.payee_id = ${row.id} and t.deleted_at is null and t.import_payee_name = ${row.name})`,
        )
      : [];
  try {
    const res = await db.batch([
      ...learn,
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "update",
          entityType: "payee",
          entityId: row.id,
          before: { id: row.id, name: row.name, hidden: row.hidden },
          after: { id: row.id, name, hidden },
        },
        whenQuery(db, same),
      ),
      payeesRepo.updateStmt(db, budgetId, row.id, { name, hidden }, now, row),
    ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    // The guard failed (a rename, hide or delete got there first): nothing was written.
    if (((res[res.length - 1] as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) {
      throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.race);
    }
  } catch (e) {
    if (payeesRepo.isUniqueViolation(e))
      throw new PayeeRefused(409, "conflict", PAYEE_ERRORS.duplicate);
    throw e;
  }
  return payeeToApi(
    { ...after, updatedAt: now },
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

/** The statements of one delete, six whatever the rows. A test appends a failing statement to prove atomicity. */
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
    const res = await db.batch(
      buildPayeeDeleteBatch(db, { budgetId, actor, now, ids, replacementId, counts }) as [
        BatchItem<"sqlite">,
        ...BatchItem<"sqlite">[],
      ],
    );
    const last = res[res.length - 1] as { meta?: { changes?: number } };
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
export async function listPayeeTransactions(
  env: Env,
  budgetId: string,
  payeeId: string,
): Promise<{ transactions: PayeeTransaction[]; total_count: number }> {
  const db = getDb(env);
  await requirePlan(db, budgetId);
  if (payeeId.startsWith(TRANSFER_PAYEE_PREFIX)) throw forbidden(PAYEE_ERRORS.transfer);
  const row = await payeesRepo.findActive(db, budgetId, payeeId);
  if (!row) throw new NotFound("Payee");
  if (row.system) throw forbidden(PAYEE_ERRORS.system);
  const [real, sched] = await Promise.all([
    payeesRepo.transactionsOf(db, budgetId, payeeId, PAYEE_TRANSACTIONS_LIMIT),
    payeesRepo.scheduledOf(db, budgetId, payeeId, PAYEE_TRANSACTIONS_LIMIT),
  ]);
  const tag = (kind: PayeeTransaction["kind"]) => (r: payeesRepo.PayeeTransactionRow) => ({
    created: r.created_at,
    row: {
      id: r.id,
      kind,
      account_id: r.account_id,
      account_name: r.account_name,
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
