import type { UpcomingSource } from "@budget/schema/scheduled-upcoming";
import { and, asc, eq, inArray, isNull, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { budgets } from "../db/schema/budgets";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { payees } from "../db/schema/payees";
import { scheduledSubtransactions as sl } from "../db/schema/scheduled-subtransactions";
import { scheduledTransactions as st } from "../db/schema/scheduled-transactions";
import { transactions } from "../db/schema/transactions";
import { idList, type LogBase, logSelectStmt } from "./guards";
import { insertSelect } from "./insert-select";

export type ScheduledBase = typeof st.$inferSelect;

/** A line of a split schedule with the names its reads carry. A deleted payee or category reads as null. */
export type ScheduledLineRow = {
  id: string;
  amount: number;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  groupName: string | null;
  inflowToReadyToAssign: boolean;
  memo: string | null;
  sort: number;
};

/** A schedule with the names and account state its reads carry. `categoryId` and `payeeId` are null once the category or payee is deleted. */
export type ScheduledRow = ScheduledBase & {
  accountName: string;
  /** True when the series account or a transfer's other account is closed. */
  accountClosed: boolean;
  /** True when a transfer's other account is closed. */
  transferClosed: boolean;
  accountOnBudget: boolean;
  payeeName: string | null;
  categoryName: string | null;
  groupName: string | null;
  /** The other account of a transfer schedule: null for a plain schedule or when it is deleted. */
  transferAccountName: string | null;
  transferAccountClosed: boolean;
  transferAccountOnBudget: boolean;
  /** The live lines of a split schedule, in order; empty for a plain schedule. */
  lines: ScheduledLineRow[];
};

const ta = alias(accounts, "ta");

/** A transfer schedule counts only while its other account exists and is open. */
const livePair = sql`(${st.transferAccountId} is null or (${ta.id} is not null and ${ta.deletedAt} is null and ${ta.closed} = 0))`;

/** The schedule's live lines as one JSON column, so no read needs a second call. */
const linesColumn =
  sql<string>`(select coalesce(json_group_array(json_object('id', x.id, 'amount', x.amount, 'payee_id', x.payee_id, 'payee_name', x.payee_name, 'category_id', x.category_id, 'category_name', x.category_name, 'group_name', x.group_name, 'inflow', x.inflow, 'memo', x.memo, 'sort', x.sort)), '[]') from (
  select l.id as id, l.amount as amount, lp.id as payee_id, lp.name as payee_name, lc.id as category_id, lc.name as category_name, lg.name as group_name, l.inflow_to_ready_to_assign as inflow, l.memo as memo, l.sort as sort
  from ${sl} l
  left join ${payees} lp on lp.id = l.payee_id and lp.deleted_at is null
  left join ${categories} lc on lc.id = l.category_id and lc.deleted_at is null
  left join ${categoryGroups} lg on lg.id = lc.group_id and lg.deleted_at is null
  where l.scheduled_transaction_id = ${st.id} and l.deleted_at is null
  order by l.sort) x)`.as("lines_json");

function parseLines(json: string | null): ScheduledLineRow[] {
  const raw = JSON.parse(json ?? "[]") as {
    id: string;
    amount: number;
    payee_id: string | null;
    payee_name: string | null;
    category_id: string | null;
    category_name: string | null;
    group_name: string | null;
    inflow: number;
    memo: string | null;
    sort: number;
  }[];
  return raw.map((l) => ({
    id: l.id,
    amount: l.amount,
    payeeId: l.payee_id,
    payeeName: l.payee_name,
    categoryId: l.category_id,
    categoryName: l.category_name,
    groupName: l.group_name,
    inflowToReadyToAssign: l.inflow === 1,
    memo: l.memo,
    sort: l.sort,
  }));
}

function selectRows(db: Db) {
  return db
    .select({
      s: st,
      accountName: accounts.name,
      accountClosed: accounts.closed,
      accountOnBudget: accounts.onBudget,
      transferAccountName: ta.name,
      transferAccountClosed: ta.closed,
      transferAccountOnBudget: ta.onBudget,
      transferAccountLive: ta.id,
      transferAccountDeletedAt: ta.deletedAt,
      payeeId: payees.id,
      payeeName: payees.name,
      categoryId: categories.id,
      categoryName: categories.name,
      groupName: categoryGroups.name,
      lines: linesColumn,
    })
    .from(st)
    .innerJoin(accounts, and(eq(accounts.id, st.accountId), isNull(accounts.deletedAt)))
    .innerJoin(budgets, and(eq(budgets.id, st.budgetId), isNull(budgets.deletedAt)))
    .leftJoin(ta, eq(ta.id, st.transferAccountId))
    .leftJoin(payees, and(eq(payees.id, st.payeeId), isNull(payees.deletedAt)))
    .leftJoin(categories, and(eq(categories.id, st.categoryId), isNull(categories.deletedAt)))
    .leftJoin(
      categoryGroups,
      and(eq(categoryGroups.id, categories.groupId), isNull(categoryGroups.deletedAt)),
    );
}

type Joined = Awaited<ReturnType<ReturnType<typeof selectRows>["limit"]>>[number];

function toRow(r: Joined): ScheduledRow {
  return {
    ...r.s,
    payeeId: r.payeeId ?? null,
    categoryId: r.categoryId ?? null,
    accountName: r.accountName,
    accountClosed: r.accountClosed || (r.transferAccountClosed ?? false),
    transferClosed: r.transferAccountClosed ?? false,
    accountOnBudget: r.accountOnBudget,
    payeeName: r.payeeName ?? null,
    categoryName: r.categoryName ?? null,
    groupName: r.groupName ?? null,
    transferAccountName: r.transferAccountName ?? null,
    transferAccountClosed: r.transferAccountClosed ?? false,
    transferAccountOnBudget: r.transferAccountOnBudget ?? false,
    lines: parseLines(r.lines),
  };
}

/** A transfer's other account that is deleted (or gone): the row is absent from every read, as a deleted series account is. */
const otherGone = (r: Joined) =>
  r.s.transferAccountId !== null &&
  (r.transferAccountLive === null || r.transferAccountDeletedAt !== null);

/** The plan's live schedules on open accounts, by next date. */
export async function listForPlan(
  db: Db,
  budgetId: string,
  opts: { accountId?: string } = {},
): Promise<ScheduledRow[]> {
  const conds = [
    eq(st.budgetId, budgetId),
    isNull(st.deletedAt),
    eq(accounts.closed, false),
    livePair,
  ];
  if (opts.accountId) {
    conds.push(
      sql`(${st.accountId} = ${opts.accountId} or ${st.transferAccountId} = ${opts.accountId})`,
    );
  }
  const rows = await selectRows(db)
    .where(and(...conds))
    .orderBy(asc(st.dateNext), asc(st.id));
  return rows.map(toRow);
}

/**
 * Several schedules at once, closed accounts included (each row says so). A deleted account's schedules are
 * absent. One JSON parameter keeps the query under D1's bound-parameter limit.
 */
export async function findMany(
  db: Db,
  budgetId: string,
  ids: readonly string[],
  opts: { includeDeleted?: boolean } = {},
): Promise<Map<string, ScheduledRow>> {
  if (ids.length === 0) return new Map();
  const conds = [
    eq(st.budgetId, budgetId),
    sql`${st.id} in (select value from json_each(${JSON.stringify(ids)}))`,
  ];
  if (!opts.includeDeleted) conds.push(isNull(st.deletedAt));
  const rows = await selectRows(db).where(and(...conds));
  return new Map(rows.filter((r) => !otherGone(r)).map((r) => [r.s.id, toRow(r)]));
}

/** Live schedules whose next date is `day` or earlier, oldest first: at most `limit + 1`. Closed and deleted accounts and plans are left out. */
export async function listDue(
  db: Db,
  opts: { budgetIds: string[] | "all"; day: string; limit: number },
): Promise<ScheduledRow[]> {
  const conds = [
    isNull(st.deletedAt),
    sql`${st.dateNext} <= ${opts.day}`,
    eq(accounts.closed, false),
    livePair,
    // an archived plan (Fresh Start) keeps its schedules but does not enter them
    sql`${st.budgetId} not in (select id from budgets where archived_at is not null)`,
  ];
  if (opts.budgetIds !== "all") {
    if (opts.budgetIds.length === 0) return [];
    conds.push(inArray(st.budgetId, opts.budgetIds));
  }
  const rows = await selectRows(db)
    .where(and(...conds))
    .orderBy(asc(st.dateNext), asc(st.id))
    .limit(opts.limit + 1);
  return rows.map(toRow);
}

export function insertStmt(db: Db, row: ScheduledBase) {
  return db.insert(st).values(row);
}

type Set = Partial<
  Pick<
    ScheduledBase,
    | "accountId"
    | "dateFirst"
    | "dateNext"
    | "frequency"
    | "amount"
    | "payeeId"
    | "categoryId"
    | "inflowToReadyToAssign"
    | "memo"
    | "flagColor"
    | "transferAccountId"
    | "deletedAt"
  >
> &
  Pick<ScheduledBase, "writeToken"> &
  Partial<Pick<ScheduledBase, "updatedAt">>;

/**
 * The gate of every change: it writes only while the row is live and still has the next date and token that
 * were read, and it sets a new token. Statements guarded by `writtenWith(id, token)` follow it in the batch.
 */
export function updateIfStmt(
  db: Db,
  id: string,
  set: Set,
  read: { dateNext: string; writeToken: string },
) {
  return db
    .update(st)
    .set(set)
    .where(
      and(
        eq(st.id, id),
        isNull(st.deletedAt),
        eq(st.dateNext, read.dateNext),
        eq(st.writeToken, read.writeToken),
      ),
    );
}

export function softDeleteIfStmt(
  db: Db,
  id: string,
  at: string,
  token: string,
  read: { dateNext: string; writeToken: string },
) {
  // updated_at stays: undo of a delete checks the soft-deleted row against the log's `before`, which carries it.
  return updateIfStmt(db, id, { deletedAt: at, writeToken: token }, read);
}

/** True while the schedule carries `token`: the guard of the statements that follow its gate. */
export function writtenWith(id: string, token: string): SQLWrapper & SQL {
  return sql`(select 1 from scheduled_transactions where id = ${id} and write_token = ${token})`;
}

/** A category's names in one read, or undefined when it is not an active category of the plan. */
export async function categoryNames(
  db: Db,
  budgetId: string,
  categoryId: string,
): Promise<
  | { name: string; groupName: string | null; kind: string | null; accountId: string | null }
  | undefined
> {
  const [r] = await db
    .select({
      name: categories.name,
      groupName: categoryGroups.name,
      kind: categories.kind,
      accountId: categories.accountId,
    })
    .from(categories)
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.budgetId, budgetId),
        isNull(categories.deletedAt),
      ),
    )
    .limit(1);
  return r
    ? { name: r.name, groupName: r.groupName ?? null, kind: r.kind, accountId: r.accountId }
    : undefined;
}

/** Points the live scheduled transactions of `fromIds` at another payee (or none); `token` renews their write token. */
export function movePayeeStmt(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
  toId: string | null,
  now: string,
  token: string,
  guard: SQL,
) {
  return db
    .update(st)
    .set({ payeeId: toId, updatedAt: now, writeToken: token })
    .where(
      sql`${st.budgetId} = ${budgetId} and ${st.payeeId} in (select value from json_each(${JSON.stringify(fromIds)})) and ${st.deletedAt} is null and ${guard}`,
    );
}

// A deleted category's live schedules (EXF-659): moved to the replacement, or cleared when there is none.

const liveIn = (budgetId: string, fromIds: readonly string[]) =>
  sql`${st.budgetId} = ${budgetId} and ${st.categoryId} in (${idList(fromIds)}) and ${st.deletedAt} is null`;

/** One change_log row per live schedule that moves (`targetId`) or is cleared (null). Put it before the update. */
export function logCategoryChangeStmt(
  db: Db,
  base: LogBase,
  budgetId: string,
  fromIds: readonly string[],
  targetId: string | null,
  guard: SQL,
) {
  return logSelectStmt(
    db,
    base,
    sql`select id, category_id from ${st} where ${liveIn(budgetId, fromIds)} and ${guard}`,
    {
      entityId: sql`id`,
      before: sql`json_object('id', id, 'category_id', category_id)`,
      after: sql`json_object('id', id, 'category_id', ${targetId}, 'reassigned_from', category_id)`,
    },
  );
}

/** Points the live schedules of `fromIds` at the target (or at no category), each under a new write token. */
export function changeCategoryStmt(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
  targetId: string | null,
  now: string,
  guard: SQL,
) {
  return db
    .update(st)
    .set({
      categoryId: targetId,
      updatedAt: now,
      writeToken: sql`lower(hex(randomblob(16)))`,
    })
    .where(sql`${liveIn(budgetId, fromIds)} and ${guard}`);
}

export type LineInsert = {
  id: string;
  amount: number;
  payeeId: string | null;
  categoryId: string | null;
  inflowToReadyToAssign: boolean;
  memo: string | null;
};

/** Inserts a schedule's lines in one statement from one bound JSON parameter; `sort` is the position. Written only while `guard` holds. */
export function insertLinesStmt(
  db: Db,
  scheduleId: string,
  budgetId: string,
  lines: readonly LineInsert[],
  now: string,
  guard?: SQLWrapper,
) {
  const j = (path: string) => sql`json_extract(v.value, ${path})`;
  const json = JSON.stringify(
    lines.map((l) => ({
      id: l.id,
      amount: l.amount,
      payee_id: l.payeeId,
      category_id: l.categoryId,
      inflow: l.inflowToReadyToAssign ? 1 : 0,
      memo: l.memo,
    })),
  );
  return insertSelect(
    db,
    sl,
    {
      id: j("$.id"),
      budgetId,
      scheduledTransactionId: scheduleId,
      amount: j("$.amount"),
      payeeId: j("$.payee_id"),
      categoryId: j("$.category_id"),
      inflowToReadyToAssign: j("$.inflow"),
      memo: j("$.memo"),
      sort: sql`v.key`,
      createdAt: now,
      updatedAt: now,
    },
    sql`from json_each(${json}) v${guard ? sql` where exists ${guard}` : sql``}`,
  );
}

/** The real lines of an entered split, all in one statement (one bound JSON parameter), written only while `guard` holds. */
export function insertEnteredLinesStmt(
  db: Db,
  parent: {
    id: string;
    budgetId: string;
    accountId: string;
    date: string;
    cleared: string;
    approved: boolean;
    createdAt: string;
  },
  lines: readonly {
    id: string;
    amount: number;
    payeeId: string | null;
    payeeName: string | null;
    categoryId: string | null;
    inflowToReadyToAssign: boolean;
    memo: string | null;
    splitIndex?: number | null;
  }[],
  guard: SQLWrapper,
) {
  const j = (path: string) => sql`json_extract(v.value, ${path})`;
  const json = JSON.stringify(
    lines.map((l) => ({
      id: l.id,
      amount: l.amount,
      payee_id: l.payeeId,
      payee_name: l.payeeName,
      category_id: l.categoryId,
      inflow: l.inflowToReadyToAssign ? 1 : 0,
      memo: l.memo,
      ix: l.splitIndex ?? 0,
    })),
  );
  return insertSelect(
    db,
    transactions,
    {
      id: j("$.id"),
      budgetId: parent.budgetId,
      accountId: parent.accountId,
      date: parent.date,
      payeeName: j("$.payee_name"),
      categoryId: j("$.category_id"),
      inflowToReadyToAssign: j("$.inflow"),
      memo: j("$.memo"),
      amount: j("$.amount"),
      cleared: parent.cleared,
      approved: parent.approved ? 1 : 0,
      createdAt: parent.createdAt,
      updatedAt: parent.createdAt,
      payeeId: j("$.payee_id"),
      parentTransactionId: parent.id,
      splitIndex: j("$.ix"),
    },
    sql`from json_each(${json}) v where exists ${guard}`,
  );
}

/** Soft-deletes the live lines of one schedule (an edit replaces them), only while `guard` holds. */
export function softDeleteLinesStmt(db: Db, scheduleId: string, now: string, guard: SQLWrapper) {
  return db
    .update(sl)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      sql`${sl.scheduledTransactionId} = ${scheduleId} and ${sl.deletedAt} is null and exists ${guard}`,
    );
}

/** A deleted category's live lines (EXF-659), of live schedules: moved to the replacement or cleared. */
const lineLiveIn = (budgetId: string, fromIds: readonly string[]) =>
  sql`${sl.budgetId} = ${budgetId} and ${sl.deletedAt} is null and ${sl.categoryId} in (select value from json_each(${JSON.stringify(fromIds)})) and ${sl.scheduledTransactionId} in (select id from scheduled_transactions where deleted_at is null)`;

export function logLineCategoryChangeStmt(
  db: Db,
  base: LogBase,
  budgetId: string,
  fromIds: readonly string[],
  targetId: string | null,
  guard: SQL,
) {
  return logSelectStmt(
    db,
    base,
    sql`select id, category_id from ${sl} where ${lineLiveIn(budgetId, fromIds)} and ${guard}`,
    {
      entityId: sql`id`,
      before: sql`json_object('id', id, 'category_id', category_id)`,
      after: sql`json_object('id', id, 'category_id', ${targetId}, 'reassigned_from', category_id)`,
    },
  );
}

/** Renews the write token (only) of the schedules whose lines are about to move, so an edit in flight gets a 409. Put it before the move. */
export function renewTokenOfLinesStmt(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
  guard: SQL,
) {
  return db
    .update(st)
    .set({ writeToken: sql`lower(hex(randomblob(16)))` })
    .where(
      sql`${st.budgetId} = ${budgetId} and ${st.deletedAt} is null and ${st.id} in (select ${sl.scheduledTransactionId} from ${sl} where ${sl.deletedAt} is null and ${sl.categoryId} in (select value from json_each(${JSON.stringify(fromIds)}))) and ${guard}`,
    );
}

export function changeLineCategoryStmt(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
  targetId: string | null,
  now: string,
  guard: SQL,
) {
  return db
    .update(sl)
    .set({ categoryId: targetId, updatedAt: now })
    .where(sql`${lineLiveIn(budgetId, fromIds)} and ${guard}`);
}

/** Points the lines of live schedules at another payee (payee delete or combine). Renew the parents' token first with `renewTokenOfPayeeLinesStmt`. */
export function moveLinePayeeStmt(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
  toId: string | null,
  now: string,
  guard: SQL,
) {
  return db
    .update(sl)
    .set({ payeeId: toId, updatedAt: now })
    .where(
      sql`${sl.budgetId} = ${budgetId} and ${sl.deletedAt} is null and ${sl.payeeId} in (select value from json_each(${JSON.stringify(fromIds)})) and ${sl.scheduledTransactionId} in (select id from scheduled_transactions where deleted_at is null) and ${guard}`,
    );
}

export function renewTokenOfPayeeLinesStmt(
  db: Db,
  budgetId: string,
  fromIds: readonly string[],
  guard: SQL,
) {
  return db
    .update(st)
    .set({ writeToken: sql`lower(hex(randomblob(16)))` })
    .where(
      sql`${st.budgetId} = ${budgetId} and ${st.deletedAt} is null and ${st.id} in (select ${sl.scheduledTransactionId} from ${sl} where ${sl.deletedAt} is null and ${sl.payeeId} in (select value from json_each(${JSON.stringify(fromIds)}))) and ${guard}`,
    );
}

/**
 * Every schedule that can still show up in a month read, in one select (EXF-505): live, on an open, on-budget
 * account, with an active category, not an inflow to Ready to Assign, and `date_next` on or before `through`
 * (the last day of the latest month read). `categoryId` narrows it to one category. A deleted payee reads as none.
 */
export async function listUpcomingSources(
  db: Db,
  budgetId: string,
  through: string,
  categoryId?: string,
): Promise<UpcomingSource[]> {
  // A transfer counts on its on-plan side: the series account when it is on-plan, else the other account.
  const plainCat = categoryId ? sql`and st.category_id = ${categoryId}` : sql``;
  const lineCat = categoryId ? sql`and l.category_id = ${categoryId}` : sql``;
  // One statement, two branches. Plain: the schedule's own category. Split: each line counts toward its own
  // category (lines of one category merge into one occurrence); the parent counts nowhere. A line is never a
  // transfer, and a Ready to Assign or uncategorized line counts nowhere.
  const rows = await db.all<{
    id: string;
    category_id: string;
    account_id: string;
    account_name: string;
    date_first: string;
    date_next: string;
    frequency: string;
    amount: number;
    payee_id: string | null;
    payee_name: string | null;
    memo: string | null;
  }>(sql`select u.id as id, u.category_id as category_id, u.account_id as account_id, u.account_name as account_name,
      u.date_first as date_first, u.date_next as date_next, u.frequency as frequency, u.amount as amount,
      p.id as payee_id, p.name as payee_name, u.memo as memo
    from (
      select st.id as id, c.id as category_id,
        case when a.on_budget = 1 then a.id else ta.id end as account_id,
        case when a.on_budget = 1 then a.name else ta.name end as account_name,
        st.date_first as date_first, st.date_next as date_next, st.frequency as frequency,
        case when a.on_budget = 1 then st.amount else 0 - st.amount end as amount,
        st.payee_id as pid, st.memo as memo
      from scheduled_transactions st
      join accounts a on a.id = st.account_id and a.deleted_at is null
      left join accounts ta on ta.id = st.transfer_account_id
      join categories c on c.id = st.category_id and c.deleted_at is null
      where st.budget_id = ${budgetId} and st.deleted_at is null and st.inflow_to_ready_to_assign = 0
        and a.closed = 0
        and (st.transfer_account_id is null or (ta.id is not null and ta.deleted_at is null and ta.closed = 0))
        and (a.on_budget = 1 or (st.transfer_account_id is not null and a.on_budget = 0 and ta.on_budget = 1))
        and st.date_next <= ${through} ${plainCat}
      union all
      select st.id as id, c.id as category_id, a.id as account_id, a.name as account_name,
        st.date_first as date_first, st.date_next as date_next, st.frequency as frequency,
        sum(l.amount) as amount,
        coalesce((select m.payee_id from scheduled_subtransactions m where m.scheduled_transaction_id = st.id and m.category_id = l.category_id and m.deleted_at is null and m.payee_id is not null order by m.sort limit 1), st.payee_id) as pid,
        coalesce((select m.memo from scheduled_subtransactions m where m.scheduled_transaction_id = st.id and m.category_id = l.category_id and m.deleted_at is null and m.memo is not null order by m.sort limit 1), st.memo) as memo
      from scheduled_transactions st
      join accounts a on a.id = st.account_id and a.deleted_at is null
      join scheduled_subtransactions l on l.scheduled_transaction_id = st.id and l.deleted_at is null
      join categories c on c.id = l.category_id and c.deleted_at is null
      where st.budget_id = ${budgetId} and st.deleted_at is null and st.transfer_account_id is null
        and a.closed = 0 and a.on_budget = 1 and l.inflow_to_ready_to_assign = 0
        and st.date_next <= ${through} ${lineCat}
      group by st.id, l.category_id
    ) u
    left join payees p on p.id = u.pid and p.deleted_at is null
    order by u.date_next, u.id, u.category_id`);
  return rows.map((r) => ({
    id: r.id,
    category_id: r.category_id,
    account_id: r.account_id,
    account_name: r.account_name,
    date_first: r.date_first,
    date_next: r.date_next,
    frequency: r.frequency as UpcomingSource["frequency"],
    amount: r.amount,
    payee_id: r.payee_id ?? null,
    payee_name: r.payee_name ?? null,
    memo: r.memo ?? null,
  }));
}

/** Ends (soft-deletes) the live schedules of a deleted account: its own transfers and the transfers to it. One change_log row each; put it before the update. */
const endsWith = (budgetId: string, accountId: string) =>
  sql`${st.budgetId} = ${budgetId} and ${st.deletedAt} is null and (${st.transferAccountId} = ${accountId} or (${st.accountId} = ${accountId} and ${st.transferAccountId} is not null))`;

export function logEndForAccountStmt(
  db: Db,
  base: LogBase,
  budgetId: string,
  accountId: string,
  guard: SQL,
) {
  const cols = (deleted: "true" | "false") =>
    sql.raw(
      `json_object('id', id, 'account_id', account_id, 'transfer_account_id', transfer_account_id, 'date_first', date_first, 'date_next', date_next, 'frequency', frequency, 'amount', amount, 'category_id', category_id, 'memo', memo, 'deleted', json('${deleted}'))`,
    );
  return logSelectStmt(
    db,
    base,
    sql`select id, account_id, transfer_account_id, date_first, date_next, frequency, amount, category_id, memo from ${st} where ${endsWith(budgetId, accountId)} and ${guard}`,
    { entityId: sql`id`, before: cols("false"), after: cols("true") },
  );
}

export function endForAccountStmt(
  db: Db,
  budgetId: string,
  accountId: string,
  now: string,
  guard: SQL,
) {
  return db
    .update(st)
    .set({ deletedAt: now, updatedAt: now, writeToken: sql`lower(hex(randomblob(16)))` })
    .where(sql`${endsWith(budgetId, accountId)} and ${guard}`);
}
