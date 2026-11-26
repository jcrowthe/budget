import { planFormatter } from "@budget/schema/plan-formats";
import { dueStep, type Frequency, nextDate, placeSchedule } from "@budget/schema/recurrence";
import {
  CREATE_NOT_SCHEDULED,
  EDIT_NOT_SCHEDULED,
  type EnterDueResult,
  SCHEDULER_MAX_PER_RUN,
  ScheduledBulkRequest,
  type ScheduledBulkResult,
  type ScheduledBulkSkipReason,
  type ScheduledLineInput,
  type ScheduledTransaction,
  ScheduledTransactionCreate,
  ScheduledTransactionUpdate,
  scheduledCategorizeSkip,
} from "@budget/schema/scheduled-transactions";
import { type CategoryUpcoming, upcomingList } from "@budget/schema/scheduled-upcoming";
import type { TransactionDetail } from "@budget/schema/transactions";
import { transferCategoryRule, transferPayeeName } from "@budget/schema/transfers";
import { z } from "zod";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsert, changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import { recomputeDefaultsStmt } from "../repositories/payee-category";
import * as payeesRepo from "../repositories/payees";
import * as repo from "../repositories/scheduled-transactions";
import * as txRepo from "../repositories/transactions";
import { formatsOfRow } from "./budgets";
import { getPlanMonthWithSources } from "./months";
import { type ResolvedPayee, resolvePayee } from "./payees";
import { newOtherSide } from "./transaction-pairs";
import { validateLines } from "./transaction-splits";
import {
  CLOSED_NO_MOVE,
  CLOSED_NO_NEW,
  CLOSED_OTHER,
  enteredTransactionWrites,
  logShape,
  refuseOwnPaymentCategory,
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

const lineToApi = (l: repo.ScheduledLineRow) => ({
  id: l.id,
  amount: l.amount,
  payee_id: l.payeeId,
  payee_name: l.payeeName,
  category_id: l.categoryId,
  category_name: l.categoryName,
  category_group_name: l.groupName,
  inflow_to_ready_to_assign: l.inflowToReadyToAssign,
  memo: l.memo,
});

export function scheduledToApi(
  row: repo.ScheduledRow,
  deleted = row.deletedAt !== null,
): ScheduledTransaction {
  const transfer = row.transferAccountId !== null;
  return {
    id: row.id,
    account_id: row.accountId,
    account_name: row.accountName,
    date_first: row.dateFirst,
    date_next: row.dateNext,
    frequency: row.frequency,
    amount: row.amount,
    payee_id: transfer ? null : row.payeeId,
    payee_name: transfer ? transferPayeeName(row.transferAccountName ?? "") : row.payeeName,
    category_id: row.categoryId,
    category_name: row.categoryName,
    category_group_name: row.groupName,
    inflow_to_ready_to_assign: row.inflowToReadyToAssign,
    memo: row.memo,
    flag_color: row.flagColor ?? null,
    transfer_account_id: row.transferAccountId,
    transfer_account_name: transfer ? row.transferAccountName : null,
    subtransactions: row.lines.map(lineToApi),
    mirror: false,
    deleted,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** The derived row the other account lists for a transfer schedule: same id, negated amount, the series account as the other side. */
export function mirrorToApi(row: repo.ScheduledRow): ScheduledTransaction {
  // Only the on-plan side of an on-plan to tracking transfer carries the category; here that is the other account.
  const carries = !row.accountOnBudget && row.transferAccountOnBudget;
  return {
    id: row.id,
    account_id: row.transferAccountId ?? "",
    account_name: row.transferAccountName ?? "",
    date_first: row.dateFirst,
    date_next: row.dateNext,
    frequency: row.frequency,
    // `0 - x` keeps zero positive.
    amount: 0 - row.amount,
    payee_id: null,
    payee_name: transferPayeeName(row.accountName),
    category_id: carries ? row.categoryId : null,
    category_name: carries ? row.categoryName : null,
    category_group_name: carries ? row.groupName : null,
    inflow_to_ready_to_assign: carries ? row.inflowToReadyToAssign : false,
    memo: row.memo,
    flag_color: null,
    transfer_account_id: row.accountId,
    transfer_account_name: row.accountName,
    subtransactions: [],
    mirror: true,
    deleted: row.deletedAt !== null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function activePlan(db: Db, budgetId: string) {
  const plan = await budgetsRepo.findActive(db, budgetId);
  if (!plan) throw new NotFound("Plan");
  return plan;
}

const SPLIT_CATEGORY = "A split transaction's category is in its lines";
const SPLIT_TRANSFER = "A transfer cannot be split";
const SPLIT_AMOUNT = "A split's amount changes with its lines: send subtransactions too";

/**
 * The lines of a split, checked with the register's rules (`validateLines`: at least two, on-plan account, own
 * payment category, sum equals the amount) and returned as schedule lines with their names, plus the payees the
 * lines create. D1 calls: one read per line (bounded by the 50-line cap, as the register's) and one for the names.
 */
async function prepareLines(
  db: Db,
  budgetId: string,
  plan: Awaited<ReturnType<typeof activePlan>>,
  account: Acc,
  p: {
    lines: readonly ScheduledLineInput[];
    amount: number;
    dateFirst: string;
    parentPayee: ResolvedPayee | undefined;
  },
  now: string,
): Promise<{ lines: repo.ScheduledLineRow[]; payeeCreates: payeesRepo.PayeeRow[] }> {
  const parent: txRepo.TransactionRow = {
    id: "",
    budgetId,
    accountId: account.id,
    date: p.dateFirst,
    payeeId: null,
    payeeName: null,
    categoryId: null,
    inflowToReadyToAssign: false,
    memo: null,
    amount: p.amount,
    cleared: "uncleared",
    approved: true,
    createdAt: now,
    deletedAt: null,
    updatedAt: now,
  };
  const { rows, payeeCreates } = await validateLines(
    db,
    budgetId,
    parent,
    p.lines,
    account as unknown as accountsRepo.AccountRow,
    now,
    p.parentPayee,
    planFormatter(formatsOfRow(plan)),
  );
  const names = await txRepo.categoryNamesMany(
    db,
    budgetId,
    rows.flatMap((r) => (r.categoryId ? [r.categoryId] : [])),
  );
  const lines = rows.map((r, i) => {
    const n = r.categoryId ? names.get(r.categoryId) : undefined;
    return {
      id: r.id,
      amount: r.amount,
      payeeId: r.payeeId,
      payeeName: r.payeeName,
      categoryId: r.categoryId,
      categoryName: n?.categoryName ?? null,
      groupName: n?.groupName ?? null,
      inflowToReadyToAssign: r.inflowToReadyToAssign,
      memo: r.memo,
      sort: i,
    };
  });
  return { lines, payeeCreates };
}

const lineInserts = (lines: readonly repo.ScheduledLineRow[]): repo.LineInsert[] =>
  lines.map((l) => ({
    id: l.id,
    amount: l.amount,
    payeeId: l.payeeId,
    categoryId: l.categoryId,
    inflowToReadyToAssign: l.inflowToReadyToAssign,
    memo: l.memo,
  }));

/** Payees a batch must find alive: every line's payee that this batch does not create. */
const linePayeeIds = (
  lines: readonly repo.ScheduledLineRow[],
  created: readonly payeesRepo.PayeeRow[],
) =>
  lines.flatMap((l) => (l.payeeId && !created.some((c) => c.id === l.payeeId) ? [l.payeeId] : []));

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

/**
 * The transactions a schedule makes when it is entered: one for a plain schedule; for a transfer the series
 * side first, then the other side, linked both ways. The category belongs to the on-plan side of an
 * on-plan to tracking transfer.
 */
function enteredRows(
  s: repo.ScheduledRow,
  date: string,
  approved: boolean,
  now: string,
): txRepo.TransactionRow[] {
  if (s.transferAccountId === null) return [enteredRow(s, date, approved, now)];
  const seriesCarries = s.accountOnBudget && !s.transferAccountOnBudget;
  const otherCarries = !s.accountOnBudget && s.transferAccountOnBudget;
  const a: txRepo.TransactionRow = {
    ...enteredRow(s, date, approved, now),
    payeeId: null,
    payeeName: transferPayeeName(s.transferAccountName ?? ""),
    categoryId: seriesCarries ? s.categoryId : null,
    inflowToReadyToAssign: seriesCarries ? s.inflowToReadyToAssign : false,
    transferAccountId: s.transferAccountId,
  };
  const b = newOtherSide(a, s.transferAccountId, s.accountName, now);
  // newOtherSide starts approved; the schedule decides.
  b.approved = approved;
  b.categoryId = otherCarries ? s.categoryId : null;
  b.inflowToReadyToAssign = otherCarries ? s.inflowToReadyToAssign : false;
  a.transferTransactionId = b.id;
  return [a, b];
}

/** The insert and create log of every row `enteredRows` made, each written only while `guard` holds. */
function enteredWrites(
  db: Db,
  actor: string,
  s: repo.ScheduledRow,
  rows: txRepo.TransactionRow[],
  lineRows: txRepo.LineRow[],
  guard: ReturnType<typeof repo.writtenWith>,
): unknown[] {
  const none = { categoryName: null, groupName: null };
  const parent = rows[0];
  if (lineRows.length > 0 && parent) {
    // A split makes a real split: the parent, every line in one statement, one create log with the lines.
    return [
      txRepo.insertIfStmt(db, parent, guard),
      repo.insertEnteredLinesStmt(db, parent, lineRows, guard),
      changeLogInsertIf(
        db,
        {
          budgetId: parent.budgetId,
          actor,
          action: "create",
          entityType: "transaction",
          entityId: parent.id,
          before: null,
          after: logShape({ ...parent, ...none }, lineRows),
        },
        guard,
      ),
    ];
  }
  return rows.flatMap((r) =>
    enteredTransactionWrites(db, actor, r, r.categoryId ? namesOfRow(s) : none, guard),
  );
}

/** The real lines of an entered split, in order, each linked to its parent; none for a plain schedule or a transfer. */
function enteredLineRows(s: repo.ScheduledRow, rows: txRepo.TransactionRow[]): txRepo.LineRow[] {
  const parent = rows[0];
  if (!parent || s.transferAccountId !== null) return [];
  return s.lines.map((l, i) => ({
    id: crypto.randomUUID(),
    budgetId: s.budgetId,
    accountId: parent.accountId,
    date: parent.date,
    payeeId: l.payeeId,
    payeeName: l.payeeName,
    categoryId: l.categoryId,
    inflowToReadyToAssign: l.inflowToReadyToAssign,
    memo: l.memo,
    amount: l.amount,
    cleared: parent.cleared,
    approved: parent.approved,
    createdAt: parent.createdAt,
    deletedAt: null,
    updatedAt: parent.updatedAt,
    parentTransactionId: parent.id,
    splitIndex: i,
    categoryName: l.categoryName,
    groupName: l.groupName,
  }));
}

const namesOfRow = (s: repo.ScheduledRow) => ({
  categoryName: s.categoryName,
  groupName: s.groupName,
});

const NO_TRANSFER_CATEGORY = "A transfer between on-plan accounts takes no category";
const TRACKING_NO_CATEGORY = "Tracking accounts do not take a category";
const SAME_ACCOUNT = "A transfer needs two different accounts";
const TRANSFER_NO_PAYEE = "A transfer has no payee: its payee is the other account";

type Acc = { id: string; name: string; closed: boolean; onBudget: boolean };

/**
 * The rules every schedule meets, on the merged fields. Returns the category's names and the category fields
 * that stand: a category that is not allowed on a changed transfer is cleared when `clearable` (it was not
 * sent), refused otherwise.
 */
async function checkRules(
  db: Db,
  budgetId: string,
  m: {
    accountId: string;
    categoryId: string | null;
    inflow: boolean;
    transferAccountId?: string | null;
  },
  known?: { account?: Acc; other?: Acc },
  changedCategory = true,
  clearable = false,
): Promise<{
  account: Acc;
  other: Acc | null;
  categoryId: string | null;
  inflow: boolean;
  category: { name: string; groupName: string | null } | null;
}> {
  const acc = known?.account ?? (await accountsRepo.findActive(db, budgetId, m.accountId));
  if (!acc) throw unprocessable("Account not found in this plan");
  if (acc.closed) throw new TransactionRefused(422, "account_closed", CLOSED_NO_NEW);
  let other: Acc | null = null;
  if (m.transferAccountId) {
    if (m.transferAccountId === acc.id) throw unprocessable(SAME_ACCOUNT);
    other =
      known?.other ?? (await accountsRepo.findActive(db, budgetId, m.transferAccountId)) ?? null;
    if (!other) throw unprocessable("Account not found in this plan");
    if (other.id === acc.id) throw unprocessable(SAME_ACCOUNT);
    if (other.closed) throw new TransactionRefused(422, "account_closed", CLOSED_OTHER);
  }
  let { categoryId, inflow } = m;
  if (categoryId && inflow) {
    throw unprocessable(
      "A transaction cannot have both a category and the Ready to Assign inflow flag",
    );
  }
  // The category belongs to the on-plan side: a plain on-plan row, or the on-plan side of an on-plan to tracking transfer.
  const allowed = other ? acc.onBudget !== other.onBudget : acc.onBudget;
  if (!allowed && (categoryId || inflow)) {
    if (!clearable) {
      throw unprocessable(
        other && acc.onBudget && other.onBudget ? NO_TRANSFER_CATEGORY : TRACKING_NO_CATEGORY,
      );
    }
    categoryId = null;
    inflow = false;
    changedCategory = false;
  }
  let category: { name: string; groupName: string | null } | null = null;
  if (categoryId && changedCategory) {
    const c = await repo.categoryNames(db, budgetId, categoryId);
    if (!c) throw unprocessable("Category not found in this plan");
    refuseOwnPaymentCategory(other && !acc.onBudget ? other : acc, c);
    category = { name: c.name, groupName: c.groupName };
  }
  return { account: acc, other, categoryId, inflow, category };
}

export async function listScheduled(
  env: Env,
  budgetId: string,
  opts: { accountId?: string } = {},
): Promise<ScheduledTransaction[]> {
  const db = getDb(env);
  await activePlan(db, budgetId);
  const out: { key: string; order: number; item: ScheduledTransaction }[] = [];
  for (const r of await repo.listForPlan(db, budgetId, opts)) {
    if (!opts.accountId || r.accountId === opts.accountId) {
      out.push({ key: `${r.dateNext} ${r.id}`, order: 0, item: scheduledToApi(r) });
    }
    if (
      r.transferAccountId !== null &&
      (!opts.accountId || r.transferAccountId === opts.accountId)
    ) {
      out.push({ key: `${r.dateNext} ${r.id}`, order: 1, item: mirrorToApi(r) });
    }
  }
  // By next date, then series id, the series before its mirror.
  out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.order - y.order));
  return out.map((o) => o.item);
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

async function enteredDetail(
  db: Db,
  budgetId: string,
  id: string,
  lines: txRepo.LineRow[] = [],
): Promise<TransactionDetail> {
  const row = await txRepo.findDetail(db, budgetId, id);
  if (!row) throw new NotFound("Transaction");
  return transactionDetailToApi(row, lines);
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
  const plan = await activePlan(db, budgetId);
  const lineInputs = v.subtransactions && v.subtransactions.length > 0 ? v.subtransactions : null;
  if (lineInputs && v.transfer_account_id) throw unprocessable(SPLIT_TRANSFER);
  if (lineInputs && (v.category_id || v.inflow_to_ready_to_assign)) {
    throw unprocessable(SPLIT_CATEGORY);
  }
  const place = placeSchedule(v.date_first, v.frequency, today);
  if (place.kind === "notScheduled") throw unprocessable(CREATE_NOT_SCHEDULED);
  const hasPayee = v.payee_id !== undefined || v.payee_name !== undefined;
  if (v.transfer_account_id && hasPayee) throw unprocessable(TRANSFER_NO_PAYEE);
  const { account, other, category } = await checkRules(db, budgetId, {
    accountId: v.account_id,
    categoryId: v.category_id ?? null,
    inflow: v.inflow_to_ready_to_assign ?? false,
    transferAccountId: v.transfer_account_id ?? null,
  });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const payee = hasPayee
      ? await resolvePayee(db, budgetId, { payee_id: v.payee_id, payee_name: v.payee_name })
      : undefined;
    const now = new Date().toISOString();
    const token = crypto.randomUUID();
    const id = crypto.randomUUID();
    const built = lineInputs
      ? await prepareLines(
          db,
          budgetId,
          plan,
          account,
          { lines: lineInputs, amount: v.amount, dateFirst: v.date_first, parentPayee: payee },
          now,
        )
      : { lines: [], payeeCreates: [] };
    const base: repo.ScheduledBase = {
      id,
      budgetId,
      accountId: account.id,
      dateFirst: v.date_first,
      dateNext: place.dateNext,
      frequency: v.frequency,
      amount: v.amount,
      payeeId: payee?.payeeId ?? null,
      categoryId: v.category_id ?? null,
      inflowToReadyToAssign: v.inflow_to_ready_to_assign ?? false,
      memo: clean(v.memo) ?? null,
      flagColor: v.flag_color ?? null,
      transferAccountId: other?.id ?? null,
      writeToken: token,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const row: repo.ScheduledRow = {
      ...base,
      accountName: account.name,
      accountClosed: false,
      transferClosed: false,
      accountOnBudget: account.onBudget,
      transferAccountName: other?.name ?? null,
      transferAccountClosed: false,
      transferAccountOnBudget: other?.onBudget ?? false,
      payeeName: payee?.name ?? null,
      categoryName: category?.name ?? null,
      groupName: category?.groupName ?? null,
      lines: built.lines,
    };
    const writes: unknown[] = [
      ...(payee?.create ? payeeInsert(db, actor, payee.create) : []),
      ...built.payeeCreates.flatMap((c) => payeeInsert(db, actor, c)),
      repo.insertStmt(db, base),
      ...(built.lines.length > 0
        ? [repo.insertLinesStmt(db, id, budgetId, lineInserts(built.lines), now)]
        : []),
      changeLogInsert(db, logEntry(actor, "create", null, row)),
      ...payeesRepo.livePayeesCheck(db, budgetId, [
        payee?.create ? null : payee?.payeeId,
        ...linePayeeIds(built.lines, built.payeeCreates),
      ]),
    ];
    let txId: string | null = null;
    let enteredLines: txRepo.LineRow[] = [];
    if (place.kind === "enterAndSchedule") {
      const txs = enteredRows(row, place.enterDate, false, now);
      txId = txs[0]?.id ?? null;
      enteredLines = enteredLineRows(row, txs);
      writes.push(...enteredWrites(db, actor, row, txs, enteredLines, repo.writtenWith(id, token)));
      // The entered row joins the payee's history: its stored default follows, in this batch.
      const recompute = recomputeDefaultsStmt(db, budgetId, [
        row.payeeId,
        ...row.lines.map((l) => l.payeeId),
      ]);
      if (recompute) writes.push(recompute);
    }
    try {
      await db.batch(stmts(writes));
    } catch (e) {
      if ((payee?.create || built.payeeCreates.length > 0) && payeesRepo.isUniqueViolation(e)) {
        continue;
      }
      if (payeesRepo.isPayeeGone(e)) continue;
      throw e;
    }
    return {
      scheduled_transaction: scheduledToApi(await readBack(db, budgetId, id)),
      transaction: txId ? await enteredDetail(db, budgetId, txId, enteredLines) : null,
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
  const plan = await activePlan(db, budgetId);
  const before = (await repo.findMany(db, budgetId, [id])).get(id);
  if (!before || before.accountClosed) throw new NotFound("Scheduled transaction");

  const frequency: Frequency = v.frequency ?? before.frequency;
  const accountId = v.account_id ?? before.accountId;
  const transferAccountId =
    v.transfer_account_id !== undefined ? v.transfer_account_id : before.transferAccountId;
  const transferChanged = transferAccountId !== before.transferAccountId;
  const wasSplit = before.lines.length > 0;
  // `subtransactions` present replaces every line; an empty list makes the schedule plain.
  const lineInputs = v.subtransactions && v.subtransactions.length > 0 ? v.subtransactions : null;
  const makesPlain = v.subtransactions !== undefined && lineInputs === null;
  const isSplit = lineInputs !== null || (wasSplit && !makesPlain);
  const sentCategoryOrInflow =
    (v.category_id !== undefined && v.category_id !== null) || v.inflow_to_ready_to_assign === true;
  if (isSplit) {
    if (transferAccountId) throw unprocessable(SPLIT_TRANSFER);
    if (sentCategoryOrInflow) throw unprocessable(SPLIT_CATEGORY);
    if (lineInputs === null && v.amount !== undefined) throw unprocessable(SPLIT_AMOUNT);
  }
  // A split has its category in its lines; the parent's own are cleared when lines are sent.
  const categoryId = isSplit
    ? null
    : v.category_id !== undefined
      ? v.category_id
      : before.categoryId;
  const inflow = isSplit ? false : (v.inflow_to_ready_to_assign ?? before.inflowToReadyToAssign);
  const hasPayee = v.payee_id !== undefined || v.payee_name !== undefined;
  if (transferAccountId && hasPayee) throw unprocessable(TRANSFER_NO_PAYEE);

  let anchor = before.dateFirst;
  let dateNext = before.dateNext;
  let enterDate: string | null = null;
  const replaced =
    v.date_first !== undefined || (v.frequency !== undefined && v.frequency !== before.frequency);
  if (replaced) {
    anchor = v.date_first ?? before.dateNext;
    const place = placeSchedule(anchor, frequency, today);
    if (place.kind === "notScheduled") throw unprocessable(EDIT_NOT_SCHEDULED);
    dateNext = place.dateNext;
    if (place.kind === "enterAndSchedule") enterDate = place.enterDate;
  }

  const sentCategory = sentCategoryOrInflow;
  const checked = await checkRules(
    db,
    budgetId,
    { accountId, categoryId, inflow, transferAccountId },
    {
      account:
        accountId === before.accountId
          ? {
              id: before.accountId,
              name: before.accountName,
              closed: before.accountClosed,
              onBudget: before.accountOnBudget,
            }
          : undefined,
      other:
        transferAccountId && transferAccountId === before.transferAccountId
          ? {
              id: transferAccountId,
              name: before.transferAccountName ?? "",
              closed: before.transferAccountClosed,
              onBudget: before.transferAccountOnBudget,
            }
          : undefined,
    },
    (v.category_id !== undefined && v.category_id !== null) ||
      accountId !== before.accountId ||
      transferChanged,
    transferChanged && !sentCategory,
  );
  const { account, other, category } = checked;
  if (isSplit && !account.onBudget) {
    throw unprocessable("A tracking account's transactions cannot be split");
  }
  const finalCategoryId = checked.categoryId;
  const finalInflow = checked.inflow;
  const categoryCleared = finalCategoryId !== categoryId || finalInflow !== inflow;
  // A transfer has no payee; a schedule made plain again takes the payee of the same request, else none.
  const clearPayee = other !== null || (transferChanged && !hasPayee);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const payee = hasPayee
      ? await resolvePayee(
          db,
          budgetId,
          { payee_id: v.payee_id, payee_name: v.payee_name },
          before.payeeId,
        )
      : undefined;
    const now = new Date().toISOString();
    const token = crypto.randomUUID();
    const built = lineInputs
      ? await prepareLines(
          db,
          budgetId,
          plan,
          account,
          {
            lines: lineInputs,
            amount: v.amount ?? before.amount,
            dateFirst: anchor,
            parentPayee: payee,
          },
          now,
        )
      : { lines: makesPlain ? [] : before.lines, payeeCreates: [] };
    const after: repo.ScheduledRow = {
      ...before,
      lines: built.lines,
      accountId: account.id,
      accountName: account.name,
      accountOnBudget: account.onBudget,
      transferAccountId: other?.id ?? null,
      transferAccountName: other?.name ?? null,
      transferAccountClosed: other?.closed ?? false,
      transferAccountOnBudget: other?.onBudget ?? false,
      dateFirst: anchor,
      dateNext,
      frequency,
      amount: v.amount ?? before.amount,
      payeeId: clearPayee ? null : payee ? payee.payeeId : before.payeeId,
      payeeName: clearPayee ? null : payee ? payee.name : before.payeeName,
      categoryId: finalCategoryId,
      categoryName:
        v.category_id === undefined && !categoryCleared && !transferChanged
          ? before.categoryName
          : (category?.name ?? (finalCategoryId === categoryId ? before.categoryName : null)),
      groupName:
        v.category_id === undefined && !categoryCleared && !transferChanged
          ? before.groupName
          : (category?.groupName ?? (finalCategoryId === categoryId ? before.groupName : null)),
      inflowToReadyToAssign: finalInflow,
      memo: v.memo !== undefined ? (clean(v.memo) ?? null) : before.memo,
      flagColor: v.flag_color !== undefined ? v.flag_color : before.flagColor,
      writeToken: token,
      updatedAt: now,
    };
    if (finalCategoryId === null) {
      after.categoryName = null;
      after.groupName = null;
    }
    const payeeWrites = [
      ...(payee?.create ? payeeInsert(db, actor, payee.create) : []),
      ...built.payeeCreates.flatMap((c) => payeeInsert(db, actor, c)),
    ];
    const guard = repo.writtenWith(id, token);
    const replacesLines = v.subtransactions !== undefined && (wasSplit || lineInputs !== null);
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
          transferAccountId: after.transferAccountId,
          updatedAt: now,
          writeToken: token,
        },
        { dateNext: before.dateNext, writeToken: before.writeToken },
      ),
      changeLogInsertIf(db, logEntry(actor, "update", before, after), guard),
      ...(replacesLines && wasSplit ? [repo.softDeleteLinesStmt(db, id, now, guard)] : []),
      ...(lineInputs
        ? [repo.insertLinesStmt(db, id, budgetId, lineInserts(built.lines), now, guard)]
        : []),
    ];
    let txId: string | null = null;
    let enteredLines: txRepo.LineRow[] = [];
    if (enterDate) {
      const txs = enteredRows(after, enterDate, false, now);
      txId = txs[0]?.id ?? null;
      enteredLines = enteredLineRows(after, txs);
      writes.push(...enteredWrites(db, actor, after, txs, enteredLines, guard));
    }
    writes.push(
      ...payeesRepo.livePayeesCheck(db, budgetId, [
        payee?.create ? null : payee?.payeeId,
        ...(lineInputs ? linePayeeIds(built.lines, built.payeeCreates) : []),
      ]),
    );
    if (enterDate) {
      const recompute = recomputeDefaultsStmt(db, budgetId, [
        after.payeeId,
        ...after.lines.map((l) => l.payeeId),
      ]);
      if (recompute) writes.push(recompute);
    }
    let results: { meta: { changes?: number } }[];
    try {
      results = (await db.batch(stmts(writes))) as unknown as typeof results;
    } catch (e) {
      if ((payee?.create || built.payeeCreates.length > 0) && payeesRepo.isUniqueViolation(e)) {
        continue;
      }
      if (payeesRepo.isPayeeGone(e)) continue;
      throw e;
    }
    if ((results[payeeWrites.length]?.meta.changes ?? 0) === 0) {
      throw new TransactionRefused(409, "conflict", CHANGED);
    }
    return {
      scheduled_transaction: scheduledToApi(await readBack(db, budgetId, id)),
      transaction: txId ? await enteredDetail(db, budgetId, txId, enteredLines) : null,
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
  if (req.op !== "enter_now" && req.op !== "delete") {
    return bulkUpdateScheduled(env, actor, budgetId, req, hooks);
  }
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
        req.op === "delete" ? CLOSED_NO_CHANGE : r.transferClosed ? CLOSED_OTHER : CLOSED_NO_NEW,
      );
    }
    rows.push(r);
  }
  const now = new Date().toISOString();
  const writes: unknown[] = [];
  // `gateIx` is where the schedule's gate statement sits in the batch: its result says whether it wrote.
  const planned: {
    row: repo.ScheduledRow;
    txId: string | null;
    lineRows: txRepo.LineRow[];
    gateIx: number;
  }[] = [];
  for (const s of rows) {
    const token = crypto.randomUUID();
    const guard = repo.writtenWith(s.id, token);
    const read = { dateNext: s.dateNext, writeToken: s.writeToken };
    if (req.op === "delete") {
      planned.push({ row: s, txId: null, lineRows: [], gateIx: writes.length });
      writes.push(
        repo.softDeleteIfStmt(db, s.id, now, token, read),
        changeLogInsertIf(db, logEntry(actor, "delete", s, { ...s, deletedAt: now }, true), guard),
      );
      continue;
    }
    const step = nextDate(s.dateFirst, s.frequency, s.dateNext);
    const txs = enteredRows(s, today, true, now);
    const after = {
      ...s,
      dateNext: step ?? s.dateNext,
      updatedAt: now,
      deletedAt: step ? null : now,
    };
    const lineRows = enteredLineRows(s, txs);
    planned.push({ row: s, txId: txs[0]?.id ?? null, lineRows, gateIx: writes.length });
    writes.push(
      repo.updateIfStmt(
        db,
        s.id,
        { dateNext: after.dateNext, deletedAt: after.deletedAt, updatedAt: now, writeToken: token },
        read,
      ),
      ...enteredWrites(db, actor, s, txs, lineRows, guard),
      changeLogInsertIf(
        db,
        logEntry(actor, step ? "update" : "delete", s, after, step === null),
        guard,
      ),
    );
  }
  if (req.op === "enter_now") {
    const recompute = recomputeDefaultsStmt(
      db,
      budgetId,
      planned.flatMap((p) => [p.row.payeeId, ...p.row.lines.map((l) => l.payeeId)]),
    );
    if (recompute) writes.push(recompute);
  }
  await hooks?.beforeWrite?.();
  const results = (await db.batch(stmts(writes))) as unknown as { meta: { changes?: number } }[];
  const wrote = planned.map((p) => (results[p.gateIx]?.meta.changes ?? 0) > 0);
  const skipped = planned.flatMap((p, i) =>
    wrote[i] ? [] : [{ id: p.row.id, reason: "changed" as const }],
  );
  const enteredIds = planned.flatMap((p, i) => (wrote[i] && p.txId ? [p.txId] : []));
  if (req.op === "delete") {
    return {
      op: req.op,
      results: planned.flatMap((p, i) =>
        wrote[i]
          ? [
              {
                id: p.row.id,
                transaction: null,
                scheduled_transaction: scheduledToApi({ ...p.row, deletedAt: now }, true),
              },
            ]
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
      return [
        {
          id: p.row.id,
          transaction: transactionDetailToApi(d, p.lineRows),
          scheduled_transaction: scheduledToApi(s),
        },
      ];
    }),
    skipped,
  };
}

type UpdateReq = Exclude<ScheduledBulkRequest, { op: "enter_now" | "delete" }>;
type RowPatch = Partial<
  Pick<
    repo.ScheduledBase,
    "categoryId" | "inflowToReadyToAssign" | "flagColor" | "memo" | "accountId"
  >
>;

/**
 * Categorize, flag, memo or move several schedules: every refusal is thrown before any write; each changed
 * schedule is one gated update plus one change_log row, all in one batch (one change set through the middleware).
 * D1 calls: the plan, the schedules, at most two op reads, one batch and one read-back, whatever the ids.
 */
async function bulkUpdateScheduled(
  env: Env,
  actor: string,
  budgetId: string,
  req: UpdateReq,
  hooks?: { beforeWrite?: () => Promise<void> },
): Promise<ScheduledBulkResult> {
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
        r.transferClosed ? CLOSED_OTHER : CLOSED_NO_CHANGE,
      );
    }
    rows.push(r);
  }
  const refuse = (s: repo.ScheduledRow, text: string) =>
    unprocessable(`Transaction ${s.id}: ${text}`);

  // The op's reads, one call at most each.
  let cat: Awaited<ReturnType<typeof repo.categoryNames>>;
  let target: accountsRepo.AccountReadRow | undefined;
  let cats = new Map<string, { kind: string | null; accountId: string | null }>();
  if (req.op === "categorize" && req.value !== "ready_to_assign") {
    cat = await repo.categoryNames(db, budgetId, req.value);
    if (!cat) throw unprocessable("Category not found in this plan");
  }
  if (req.op === "move") {
    target = await accountsRepo.findActive(db, budgetId, req.value);
    if (!target) throw unprocessable("Account not found in this plan");
    if (target.closed) throw new TransactionRefused(422, "account_closed", CLOSED_NO_MOVE);
    const catIds = [...new Set(rows.flatMap((s) => (s.categoryId ? [s.categoryId] : [])))];
    if (catIds.length > 0) cats = await txRepo.categoryNamesMany(db, budgetId, catIds);
  }

  const now = new Date().toISOString();
  const skippedAt = new Map<string, ScheduledBulkSkipReason>();
  const writes: unknown[] = [];
  const planned: { row: repo.ScheduledRow; gateIx: number }[] = [];
  const mirrors = new Set(req.op === "move" ? (req.mirror_ids ?? []) : []);
  const plan = (s: repo.ScheduledRow, patch: RowPatch, view: Partial<repo.ScheduledRow>) => {
    const token = crypto.randomUUID();
    const after: repo.ScheduledRow = { ...s, ...patch, ...view, updatedAt: now, writeToken: token };
    planned.push({ row: s, gateIx: writes.length });
    writes.push(
      repo.updateIfStmt(
        db,
        s.id,
        { ...patch, updatedAt: now, writeToken: token },
        { dateNext: s.dateNext, writeToken: s.writeToken },
      ),
      changeLogInsertIf(db, logEntry(actor, "update", s, after), repo.writtenWith(s.id, token)),
    );
  };

  for (const s of rows) {
    const other = s.transferAccountId
      ? {
          id: s.transferAccountId,
          name: s.transferAccountName ?? "",
          onBudget: s.transferAccountOnBudget,
        }
      : null;
    switch (req.op) {
      case "categorize": {
        const skip = scheduledCategorizeSkip({
          split: s.lines.length > 0,
          onBudget: s.accountOnBudget,
          other: other ? { onBudget: other.onBudget } : null,
        });
        if (skip) {
          skippedAt.set(s.id, skip);
          break;
        }
        const onPlanSide =
          other && !s.accountOnBudget ? other : { id: s.accountId, name: s.accountName };
        if (cat) refuseOwnPaymentCategory(onPlanSide, cat);
        const toRta = req.value === "ready_to_assign";
        if (
          toRta
            ? s.inflowToReadyToAssign && s.categoryId === null
            : s.categoryId === req.value && !s.inflowToReadyToAssign
        ) {
          skippedAt.set(s.id, "unchanged");
          break;
        }
        plan(
          s,
          { categoryId: toRta ? null : req.value, inflowToReadyToAssign: toRta },
          { categoryName: cat?.name ?? null, groupName: cat?.groupName ?? null },
        );
        break;
      }
      case "flag": {
        if ((s.flagColor ?? null) === req.value) skippedAt.set(s.id, "unchanged");
        else plan(s, { flagColor: req.value }, {});
        break;
      }
      case "memo": {
        const memo = clean(req.value) ?? null;
        if (memo === (s.memo ?? null)) skippedAt.set(s.id, "unchanged");
        else plan(s, { memo }, {});
        break;
      }
      case "move": {
        const t = target as accountsRepo.AccountReadRow;
        if (mirrors.has(s.id)) {
          skippedAt.set(s.id, "mirror");
          break;
        }
        if (s.accountId === t.id) {
          skippedAt.set(s.id, "unchanged");
          break;
        }
        if (s.transferAccountId === t.id) {
          throw refuse(s, "a transfer cannot be moved into its other account");
        }
        if (s.lines.length > 0 && !t.onBudget) {
          throw refuse(
            s,
            `${t.name} is a tracking account, so its transactions can't be split. Make it a plain transaction first.`,
          );
        }
        const hasCategory = s.categoryId !== null || s.inflowToReadyToAssign;
        if (hasCategory) {
          const allowed = other ? t.onBudget !== other.onBudget : t.onBudget;
          if (!allowed) {
            throw refuse(
              s,
              other && t.onBudget && other.onBudget
                ? NO_TRANSFER_CATEGORY
                : `${t.name} is a tracking account, so its transactions can't have a category. Remove the category first.`,
            );
          }
          const side = other && !t.onBudget ? other : t;
          try {
            refuseOwnPaymentCategory(side, s.categoryId ? cats.get(s.categoryId) : undefined);
          } catch (e) {
            if (e instanceof TransactionRefused) {
              throw new TransactionRefused(e.status, e.code, `Transaction ${s.id}: ${e.message}`);
            }
            throw e;
          }
        }
        plan(s, { accountId: t.id }, { accountName: t.name, accountOnBudget: t.onBudget });
        break;
      }
    }
  }

  if (planned.length > 0) {
    await hooks?.beforeWrite?.();
    const out = (await db.batch(stmts(writes))) as unknown as { meta: { changes?: number } }[];
    for (const p of planned) {
      if ((out[p.gateIx]?.meta.changes ?? 0) === 0) skippedAt.set(p.row.id, "changed");
    }
  }
  const writtenIds = planned.map((p) => p.row.id).filter((id) => !skippedAt.has(id));
  const fresh = await repo.findMany(db, budgetId, writtenIds);
  return {
    op: req.op,
    results: writtenIds.flatMap((id) => {
      const r = fresh.get(id);
      return r ? [{ id, transaction: null, scheduled_transaction: scheduledToApi(r) }] : [];
    }),
    skipped: ids.flatMap((id) => {
      const reason = skippedAt.get(id);
      return reason ? [{ id, reason }] : [];
    }),
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
  const planned: { row: repo.ScheduledRow; txId: string; date: string; gateIx: number }[] = [];
  for (const s of due) {
    const step = dueStep(s.dateFirst, s.frequency, s.dateNext, opts.day);
    if (!step) continue;
    const token = crypto.randomUUID();
    const guard = repo.writtenWith(s.id, token);
    const txs = enteredRows(s, step.enterDate, false, now);
    const after = {
      ...s,
      dateNext: step.dateNext ?? s.dateNext,
      updatedAt: now,
      deletedAt: step.dateNext ? null : now,
    };
    planned.push({ row: s, txId: txs[0]?.id ?? "", date: step.enterDate, gateIx: writes.length });
    writes.push(
      repo.updateIfStmt(
        db,
        s.id,
        { dateNext: after.dateNext, deletedAt: after.deletedAt, updatedAt: now, writeToken: token },
        { dateNext: s.dateNext, writeToken: s.writeToken },
      ),
      ...enteredWrites(db, opts.actor, s, txs, enteredLineRows(s, txs), guard),
      changeLogInsertIf(
        db,
        logEntry(opts.actor, step.dateNext ? "update" : "delete", s, after, !step.dateNext),
        guard,
      ),
    );
  }
  if (planned.length === 0) return { day: opts.day, entered: [], has_more: hasMore };
  for (const planId of new Set(planned.map((p) => p.row.budgetId))) {
    const recompute = recomputeDefaultsStmt(
      db,
      planId,
      planned
        .filter((p) => p.row.budgetId === planId)
        .flatMap((p) => [p.row.payeeId, ...p.row.lines.map((l) => l.payeeId)]),
    );
    if (recompute) writes.push(recompute);
  }
  const results = (await db.batch(stmts(writes))) as unknown as { meta: { changes?: number } }[];
  return {
    day: opts.day,
    entered: planned.flatMap((p, i) =>
      (results[p.gateIx]?.meta.changes ?? 0) > 0
        ? [{ scheduled_transaction_id: p.row.id, transaction_id: p.txId, date: p.date }]
        : [],
    ),
    has_more: hasMore,
  };
}

const isUuid = (s: string) => z.uuid().safeParse(s).success;

/**
 * The scheduled transactions dated inside one month for one category (the Activity popover), with the category's
 * Available. One month read gives both the figures and the schedules behind them, so the calls are constant.
 */
export async function listUpcomingForCategory(
  env: Env,
  budgetId: string,
  month: string,
  categoryId: string,
): Promise<CategoryUpcoming> {
  if (!isUuid(budgetId)) throw new NotFound("Plan");
  if (!isUuid(categoryId)) throw new NotFound("Category");
  const { detail, sources } = await getPlanMonthWithSources(env, budgetId, month);
  const c = detail.groups.flatMap((g) => g.categories).find((x) => x.id === categoryId);
  if (!c) throw new NotFound("Category");
  return {
    category_id: c.id,
    month: detail.month,
    upcoming: c.upcoming,
    upcoming_count: c.upcoming_count,
    available: c.available,
    available_after_upcoming: c.available_after_upcoming,
    occurrences: c.kind === null ? upcomingList(sources, c.id, detail.month) : [],
  };
}
