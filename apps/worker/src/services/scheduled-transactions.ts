import {
  type Frequency,
  dueStep,
  nextDate,
  placeSchedule,
} from "@budget/schema/recurrence";
import {
  CREATE_NOT_SCHEDULED,
  EDIT_NOT_SCHEDULED,
  type EnterDueResult,
  SCHEDULER_MAX_PER_RUN,
  ScheduledBulkRequest,
  type ScheduledBulkResult,
  type ScheduledTransaction,
  ScheduledTransactionCreate,
  ScheduledTransactionUpdate,
} from "@budget/schema/scheduled-transactions";
import type { TransactionDetail } from "@budget/schema/transactions";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert, changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as payeesRepo from "../repositories/payees";
import * as repo from "../repositories/scheduled-transactions";
import * as txRepo from "../repositories/transactions";
import { resolvePayee } from "./payees";
import {
  CLOSED_NO_NEW,
  enteredTransactionWrites,
  TransactionRefused,
  transactionDetailToApi,
} from "./transactions";

type Db = ReturnType<typeof getDb>;
type Stmts = Parameters<Db["batch"]>[0];
const stmts = (list: unknown[]) => list as unknown as Stmts;
const MAX_ATTEMPTS = 5;

const unprocessable = (detail: string) =>
  new TransactionRefused(422, "unprocessable_entity", detail);
const CHANGED = "The scheduled transaction changed; reload it";
const CLOSED_NO_CHANGE = "This account is closed: its scheduled transactions cannot be changed";

const utcToday = () => new Date().toISOString().slice(0, 10);
const clean = (v: string | null | undefined) => {
  if (v === undefined) return undefined;
  const t = v?.trim() ?? "";
  return t === "" ? null : t;
};

export function scheduledToApi(row: repo.ScheduledRow, deleted = row.deletedAt !== null): ScheduledTransaction {
  return {
    id: row.id,
    account_id: row.accountId,
    account_name: row.accountName,
    date_first: row.dateFirst,
    date_next: row.dateNext,
    frequency: row.frequency,
    amount: row.amount,
    payee_id: row.payeeId,
    payee_name: row.payeeName,
    category_id: row.categoryId,
    category_name: row.categoryName,
    category_group_name: row.groupName,
    inflow_to_ready_to_assign: row.inflowToReadyToAssign,
    memo: row.memo,
    flag_color: row.flagColor ?? null,
    deleted,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function activePlan(db: Db, budgetId: string) {
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
}

function logEntry(
  actor: string,
  action: "create" | "update" | "delete",
  before: repo.ScheduledRow | null,
  after: repo.ScheduledRow,
  afterDeleted = false,
) {
  return {
    budgetId: after.budgetId,
    actor,
    action,
    entityType: "scheduled_transaction",
    entityId: after.id,
    before: before ? scheduledToApi(before) : null,
    after: scheduledToApi(after, afterDeleted),
  } as const;
}

function payeeInsert(db: Db, actor: string, p: payeesRepo.PayeeRow) {
  return [
    payeesRepo.insertStmt(db, p),
    changeLogInsert(db, {
      budgetId: p.budgetId,
      actor,
      action: "create",
      entityType: "payee",
      entityId: p.id,
      before: null,
      after: { id: p.id, name: p.name, hidden: p.hidden, system: p.system },
    }),
  ];
}

/** The transaction a schedule makes when it is entered. */
function enteredRow(
  s: repo.ScheduledRow,
  date: string,
  approved: boolean,
  now: string,
): txRepo.TransactionRow {
  return {
    id: crypto.randomUUID(),
    budgetId: s.budgetId,
    accountId: s.accountId,
    date,
    payeeId: s.payeeId,
    payeeName: s.payeeName,
    categoryId: s.accountOnBudget ? s.categoryId : null,
    inflowToReadyToAssign: s.accountOnBudget ? s.inflowToReadyToAssign : false,
    memo: s.memo,
    amount: s.amount,
    cleared: "uncleared",
    approved,
    createdAt: now,
    deletedAt: null,
    updatedAt: now,
    flagColor: s.flagColor ?? null,
  };
}

const namesOfRow = (s: repo.ScheduledRow) => ({
  categoryName: s.categoryName,
  groupName: s.groupName,
});

/** The rules every schedule meets, on the merged fields. Returns the category's names. */
async function checkRules(
  db: Db,
  budgetId: string,
  m: { accountId: string; categoryId: string | null; inflow: boolean },
  account?: accountsRepo.AccountRow | { closed: boolean; onBudget: boolean; id: string; name: string },
  changedCategory = true,
): Promise<{ account: { id: string; name: string; closed: boolean; onBudget: boolean }; category: { name: string; groupName: string | null } | null }> {
  const acc = account ?? (await accountsRepo.findActive(db, budgetId, m.accountId));
  if (!acc) throw unprocessable("Account not found in this plan");
  if (acc.closed) throw new TransactionRefused(422, "account_closed", CLOSED_NO_NEW);
  if (m.categoryId && m.inflow) {
    throw unprocessable(
      "A transaction cannot have both a category and the Ready to Assign inflow flag",
    );
  }
  if (!acc.onBudget && (m.categoryId || m.inflow)) {
    throw unprocessable("Tracking accounts do not take a category");
  }
  let category: { name: string; groupName: string | null } | null = null;
  if (m.categoryId && changedCategory) {
    const c = await repo.categoryNames(db, budgetId, m.categoryId);
    if (!c) throw unprocessable("Category not found in this plan");
    category = c;
  }
  return { account: acc, category };
}

export async function listScheduled(
  env: Env,
  budgetId: string,
  opts: { accountId?: string } = {},
): Promise<ScheduledTransaction[]> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  return (await repo.listForPlan(db, budgetId, opts)).map((r) => scheduledToApi(r));
}

export async function getScheduled(
  env: Env,
  budgetId: string,
  id: string,
): Promise<ScheduledTransaction> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  const row = (await repo.findMany(db, budgetId, [id])).get(id);
  if (!row || row.accountClosed) throw new NotFound("Scheduled transaction");
  return scheduledToApi(row);
}

async function readBack(db: Db, budgetId: string, id: string): Promise<repo.ScheduledRow> {
  const row = (await repo.findMany(db, budgetId, [id], { includeDeleted: true })).get(id);
  if (!row) throw new NotFound("Scheduled transaction");
  return row;
}

async function enteredDetail(db: Db, budgetId: string, id: string): Promise<TransactionDetail> {
  const row = await txRepo.findDetail(db, budgetId, id);
  if (!row) throw new NotFound("Transaction");
  return transactionDetailToApi(row, []);
}

export async function createScheduled(
  env: Env,
  actor: string,
  budgetId: string,
  input: ScheduledTransactionCreate,
  today: string = utcToday(),
): Promise<{ scheduled_transaction: ScheduledTransaction; transaction: TransactionDetail | null }> {
  const v = ScheduledTransactionCreate.parse(input);
  const db = getDb(env);
  await activePlan(db, budgetId);
  const place = placeSchedule(v.date_first, v.frequency, today);
  if (place.kind === "notScheduled") throw unprocessable(CREATE_NOT_SCHEDULED);
  const hasPayee = v.payee_id !== undefined || v.payee_name !== undefined;
  const { account, category } = await checkRules(db, budgetId, {
    accountId: v.account_id,
    categoryId: v.category_id ?? null,
    inflow: v.inflow_to_ready_to_assign ?? false,
  });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const payee = hasPayee
      ? await resolvePayee(db, budgetId, { payee_id: v.payee_id, payee_name: v.payee_name })
      : undefined;
    const now = new Date().toISOString();
    const token = crypto.randomUUID();
    const id = crypto.randomUUID();
    const base: repo.ScheduledBase = {
      id,
      budgetId,
      accountId: account.id,
      dateFirst: v.date_first,
      dateNext: place.kind === "schedule" ? place.dateNext : place.dateNext,
      frequency: v.frequency,
      amount: v.amount,
      payeeId: payee?.payeeId ?? null,
      categoryId: v.category_id ?? null,
      inflowToReadyToAssign: v.inflow_to_ready_to_assign ?? false,
      memo: clean(v.memo) ?? null,
      flagColor: v.flag_color ?? null,
      writeToken: token,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const row: repo.ScheduledRow = {
      ...base,
      accountName: account.name,
      accountClosed: false,
      accountOnBudget: account.onBudget,
      payeeName: payee?.name ?? null,
      categoryName: category?.name ?? null,
      groupName: category?.groupName ?? null,
    };
    const writes: unknown[] = [
      ...(payee?.create ? payeeInsert(db, actor, payee.create) : []),
      repo.insertStmt(db, base),
      changeLogInsert(db, logEntry(actor, "create", null, row)),
    ];
    let txId: string | null = null;
    if (place.kind === "enterAndSchedule") {
      const tx = enteredRow(row, place.enterDate, false, now);
      txId = tx.id;
      writes.push(
        ...enteredTransactionWrites(db, actor, tx, namesOfRow(row), repo.writtenWith(id, token)),
      );
    }
    try {
      await db.batch(stmts(writes));
    } catch (e) {
      if (payee?.create && payeesRepo.isUniqueViolation(e)) continue;
      throw e;
    }
    return {
      scheduled_transaction: scheduledToApi(await readBack(db, budgetId, id)),
      transaction: txId ? await enteredDetail(db, budgetId, txId) : null,
    };
  }
  throw new TransactionRefused(409, "conflict", "Payee was modified concurrently");
}

export async function updateScheduled(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
  input: ScheduledTransactionUpdate,
  today: string = utcToday(),
): Promise<{ scheduled_transaction: ScheduledTransaction; transaction: TransactionDetail | null }> {
  const v = ScheduledTransactionUpdate.parse(input);
  const db = getDb(env);
  await activePlan(db, budgetId);
  const before = (await repo.findMany(db, budgetId, [id])).get(id);
  if (!before || before.accountClosed) throw new NotFound("Scheduled transaction");

  const frequency: Frequency = v.frequency ?? before.frequency;
  const accountId = v.account_id ?? before.accountId;
  const categoryId = v.category_id !== undefined ? v.category_id : before.categoryId;
  const inflow = v.inflow_to_ready_to_assign ?? before.inflowToReadyToAssign;

  let anchor = before.dateFirst;
  let dateNext = before.dateNext;
  let enterDate: string | null = null;
  const replaced = v.date_first !== undefined || (v.frequency !== undefined && v.frequency !== before.frequency);
  if (replaced) {
    anchor = v.date_first ?? before.dateNext;
    const place = placeSchedule(anchor, frequency, today);
    if (place.kind === "notScheduled") throw unprocessable(EDIT_NOT_SCHEDULED);
    dateNext = place.dateNext;
    if (place.kind === "enterAndSchedule") enterDate = place.enterDate;
  }

  const { account, category } = await checkRules(
    db,
    budgetId,
    { accountId, categoryId, inflow },
    accountId === before.accountId
      ? { id: before.accountId, name: before.accountName, closed: before.accountClosed, onBudget: before.accountOnBudget }
      : undefined,
    v.category_id !== undefined && v.category_id !== null,
  );
  const hasPayee = v.payee_id !== undefined || v.payee_name !== undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const payee = hasPayee
      ? await resolvePayee(db, budgetId, { payee_id: v.payee_id, payee_name: v.payee_name }, before.payeeId)
      : undefined;
    const now = new Date().toISOString();
    const token = crypto.randomUUID();
    const after: repo.ScheduledRow = {
      ...before,
      accountId: account.id,
      accountName: account.name,
      accountOnBudget: account.onBudget,
      dateFirst: anchor,
      dateNext,
      frequency,
      amount: v.amount ?? before.amount,
      payeeId: payee ? payee.payeeId : before.payeeId,
      payeeName: payee ? payee.name : before.payeeName,
      categoryId,
      categoryName: v.category_id === undefined ? before.categoryName : (category?.name ?? null),
      groupName: v.category_id === undefined ? before.groupName : (category?.groupName ?? null),
      inflowToReadyToAssign: inflow,
      memo: v.memo !== undefined ? (clean(v.memo) ?? null) : before.memo,
      flagColor: v.flag_color !== undefined ? v.flag_color : before.flagColor,
      writeToken: token,
      updatedAt: now,
    };
    if (categoryId === null) {
      after.categoryName = null;
      after.groupName = null;
    }
    const payeeWrites = payee?.create ? payeeInsert(db, actor, payee.create) : [];
    const guard = repo.writtenWith(id, token);
    const writes: unknown[] = [
      ...payeeWrites,
      repo.updateIfStmt(
        db,
        id,
        {
          accountId: after.accountId,
          dateFirst: after.dateFirst,
          dateNext: after.dateNext,
          frequency: after.frequency,
          amount: after.amount,
          payeeId: after.payeeId,
          categoryId: after.categoryId,
          inflowToReadyToAssign: after.inflowToReadyToAssign,
          memo: after.memo,
          flagColor: after.flagColor,
          updatedAt: now,
          writeToken: token,
        },
        { dateNext: before.dateNext, writeToken: before.writeToken },
      ),
      changeLogInsertIf(db, logEntry(actor, "update", before, after), guard),
    ];
    let txId: string | null = null;
    if (enterDate) {
      const tx = enteredRow(after, enterDate, false, now);
      txId = tx.id;
      writes.push(...enteredTransactionWrites(db, actor, tx, namesOfRow(after), guard));
    }
    let results: { meta: { changes?: number } }[];
    try {
      results = (await db.batch(stmts(writes))) as unknown as typeof results;
    } catch (e) {
      if (payee?.create && payeesRepo.isUniqueViolation(e)) continue;
      throw e;
    }
    if ((results[payeeWrites.length]?.meta.changes ?? 0) === 0) {
      throw new TransactionRefused(409, "conflict", CHANGED);
    }
    return {
      scheduled_transaction: scheduledToApi(await readBack(db, budgetId, id)),
      transaction: txId ? await enteredDetail(db, budgetId, txId) : null,
    };
  }
  throw new TransactionRefused(409, "conflict", "Payee was modified concurrently");
}

/** Several schedules entered now or deleted, in one request with a fixed number of D1 calls. */
export async function bulkScheduled(
  env: Env,
  actor: string,
  budgetId: string,
  input: ScheduledBulkRequest,
  today: string = utcToday(),
  hooks?: { beforeWrite?: () => Promise<void> },
): Promise<ScheduledBulkResult> {
  const req = ScheduledBulkRequest.parse(input);
  const db = getDb(env);
  await activePlan(db, budgetId);
  const ids = [...new Set(req.ids)];
  const found = await repo.findMany(db, budgetId, ids);
  const rows: repo.ScheduledRow[] = [];
  for (const id of ids) {
    const r = found.get(id);
    if (!r) throw new NotFound("Scheduled transaction");
    if (r.accountClosed) {
      throw new TransactionRefused(
        422,
        "account_closed",
        req.op === "enter_now" ? CLOSED_NO_NEW : CLOSED_NO_CHANGE,
      );
    }
    rows.push(r);
  }
  const now = new Date().toISOString();
  const writes: unknown[] = [];
  const planned: { row: repo.ScheduledRow; txId: string | null }[] = [];
  for (const s of rows) {
    const token = crypto.randomUUID();
    const guard = repo.writtenWith(s.id, token);
    const read = { dateNext: s.dateNext, writeToken: s.writeToken };
    if (req.op === "delete") {
      writes.push(
        repo.softDeleteIfStmt(db, s.id, now, token, read),
        changeLogInsertIf(db, logEntry(actor, "delete", s, { ...s, deletedAt: now }, true), guard),
      );
      planned.push({ row: s, txId: null });
      continue;
    }
    const step = nextDate(s.dateFirst, s.frequency, s.dateNext);
    const tx = enteredRow(s, today, true, now);
    const after = { ...s, dateNext: step ?? s.dateNext, updatedAt: now, deletedAt: step ? null : now };
    writes.push(
      repo.updateIfStmt(
        db,
        s.id,
        { dateNext: after.dateNext, deletedAt: after.deletedAt, updatedAt: now, writeToken: token },
        read,
      ),
      ...enteredTransactionWrites(db, actor, tx, namesOfRow(s), guard),
      changeLogInsertIf(
        db,
        logEntry(actor, step ? "update" : "delete", s, after, step === null),
        guard,
      ),
    );
    planned.push({ row: s, txId: tx.id });
  }
  await hooks?.beforeWrite?.();
  const per = req.op === "delete" ? 2 : 4;
  const results = (await db.batch(stmts(writes))) as unknown as { meta: { changes?: number } }[];
  const wrote = planned.map((_, i) => (results[i * per]?.meta.changes ?? 0) > 0);
  const skipped = planned.flatMap((p, i) =>
    wrote[i] ? [] : [{ id: p.row.id, reason: "changed" as const }],
  );
  const enteredIds = planned.flatMap((p, i) => (wrote[i] && p.txId ? [p.txId] : []));
  if (req.op === "delete") {
    return {
      op: req.op,
      results: planned.flatMap((p, i) =>
        wrote[i]
          ? [{ id: p.row.id, transaction: null, scheduled_transaction: scheduledToApi({ ...p.row, deletedAt: now }, true) }]
          : [],
      ),
      skipped,
    };
  }
  const [details, fresh] = await Promise.all([
    txRepo.findDetailMany(db, budgetId, enteredIds),
    repo.findMany(db, budgetId, ids, { includeDeleted: true }),
  ]);
  return {
    op: req.op,
    results: planned.flatMap((p, i) => {
      const s = fresh.get(p.row.id);
      const d = p.txId ? details.get(p.txId) : undefined;
      if (!wrote[i] || !s || !d) return [];
      return [{ id: p.row.id, transaction: transactionDetailToApi(d, []), scheduled_transaction: scheduledToApi(s) }];
    }),
    skipped,
  };
}

export async function deleteScheduled(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
): Promise<{ scheduled_transaction: ScheduledTransaction }> {
  const r = await bulkScheduled(env, actor, budgetId, { op: "delete", ids: [id] });
  const hit = r.results[0];
  if (!hit) throw new TransactionRefused(409, "conflict", CHANGED);
  return { scheduled_transaction: hit.scheduled_transaction };
}

export async function enterScheduledNow(
  env: Env,
  actor: string,
  budgetId: string,
  id: string,
  today: string = utcToday(),
  hooks?: { beforeWrite?: () => Promise<void> },
): Promise<{ transaction: TransactionDetail; scheduled_transaction: ScheduledTransaction }> {
  const r = await bulkScheduled(env, actor, budgetId, { op: "enter_now", ids: [id] }, today, hooks);
  const hit = r.results[0];
  if (!hit?.transaction) throw new TransactionRefused(409, "conflict", CHANGED);
  return { transaction: hit.transaction, scheduled_transaction: hit.scheduled_transaction };
}

/**
 * Enters what is due: each live schedule on an open account whose next date is `day` or earlier becomes one
 * unapproved transaction dated its next date, and moves to the first date after `day` (a one-off is removed).
 * The oldest go first, at most `limit` per call. Two calls at once enter each occurrence once.
 * D1 calls: one read and one batch, whatever the number of schedules.
 */
export async function enterDue(
  env: Env,
  opts: { budgetIds: string[] | "all"; day: string; actor: string; limit?: number },
): Promise<EnterDueResult> {
  const limit = opts.limit ?? SCHEDULER_MAX_PER_RUN;
  const db = getDb(env);
  const found = await repo.listDue(db, { budgetIds: opts.budgetIds, day: opts.day, limit });
  const hasMore = found.length > limit;
  const due = found.slice(0, limit);
  if (due.length === 0) return { day: opts.day, entered: [], has_more: false };
  const now = new Date().toISOString();
  const writes: unknown[] = [];
  const planned: { row: repo.ScheduledRow; txId: string; date: string }[] = [];
  for (const s of due) {
    const step = dueStep(s.dateFirst, s.frequency, s.dateNext, opts.day);
    if (!step) continue;
    const token = crypto.randomUUID();
    const guard = repo.writtenWith(s.id, token);
    const tx = enteredRow(s, step.enterDate, false, now);
    const after = {
      ...s,
      dateNext: step.dateNext ?? s.dateNext,
      updatedAt: now,
      deletedAt: step.dateNext ? null : now,
    };
    writes.push(
      repo.updateIfStmt(
        db,
        s.id,
        { dateNext: after.dateNext, deletedAt: after.deletedAt, updatedAt: now, writeToken: token },
        { dateNext: s.dateNext, writeToken: s.writeToken },
      ),
      ...enteredTransactionWrites(db, opts.actor, tx, namesOfRow(s), guard),
      changeLogInsertIf(
        db,
        logEntry(opts.actor, step.dateNext ? "update" : "delete", s, after, !step.dateNext),
        guard,
      ),
    );
    planned.push({ row: s, txId: tx.id, date: step.enterDate });
  }
  if (planned.length === 0) return { day: opts.day, entered: [], has_more: hasMore };
  const results = (await db.batch(stmts(writes))) as unknown as { meta: { changes?: number } }[];
  return {
    day: opts.day,
    entered: planned.flatMap((p, i) =>
      (results[i * 4]?.meta.changes ?? 0) > 0
        ? [{ scheduled_transaction_id: p.row.id, transaction_id: p.txId, date: p.date }]
        : [],
    ),
    has_more: hasMore,
  };
}
