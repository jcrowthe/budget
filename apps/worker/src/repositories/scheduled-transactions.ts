import { and, asc, eq, inArray, isNull, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { budgets } from "../db/schema/budgets";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { payees } from "../db/schema/payees";
import { scheduledTransactions as st } from "../db/schema/scheduled-transactions";

export type ScheduledBase = typeof st.$inferSelect;

/** A schedule with the names and account state its reads carry. `categoryId` and `payeeId` are null once the category or payee is deleted. */
export type ScheduledRow = ScheduledBase & {
  accountName: string;
  accountClosed: boolean;
  accountOnBudget: boolean;
  payeeName: string | null;
  categoryName: string | null;
  groupName: string | null;
};

function selectRows(db: Db) {
  return db
    .select({
      s: st,
      accountName: accounts.name,
      accountClosed: accounts.closed,
      accountOnBudget: accounts.onBudget,
      payeeId: payees.id,
      payeeName: payees.name,
      categoryId: categories.id,
      categoryName: categories.name,
      groupName: categoryGroups.name,
    })
    .from(st)
    .innerJoin(accounts, and(eq(accounts.id, st.accountId), isNull(accounts.deletedAt)))
    .innerJoin(budgets, and(eq(budgets.id, st.budgetId), isNull(budgets.deletedAt)))
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
    accountClosed: r.accountClosed,
    accountOnBudget: r.accountOnBudget,
    payeeName: r.payeeName ?? null,
    categoryName: r.categoryName ?? null,
    groupName: r.groupName ?? null,
  };
}

/** The plan's live schedules on open accounts, by next date. */
export async function listForPlan(
  db: Db,
  budgetId: string,
  opts: { accountId?: string } = {},
): Promise<ScheduledRow[]> {
  const conds = [eq(st.budgetId, budgetId), isNull(st.deletedAt), eq(accounts.closed, false)];
  if (opts.accountId) conds.push(eq(st.accountId, opts.accountId));
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
  return new Map(rows.map((r) => [r.s.id, toRow(r)]));
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
    | "deletedAt"
  >
> &
  Pick<ScheduledBase, "writeToken" | "updatedAt">;

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
  return updateIfStmt(db, id, { deletedAt: at, updatedAt: at, writeToken: token }, read);
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
