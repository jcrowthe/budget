import { type CategoryValue, nextDefault } from "@budget/schema/payee-category";
import type { PayeeSystem } from "@budget/schema/payees";
import { and, eq, isNull, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { changeLog } from "../db/schema/change-log";
import { payees } from "../db/schema/payees";
import { currentChangeSetId } from "../history/change-set";
import { type LogBase, logSelectStmt } from "./guards";
import { insertSelect } from "./insert-select";
import { liveCategorySql, recentValueSql } from "./payee-category";

/** The columns of the payee's remembered category (EXF-515). */
type CategoryCols =
  | "categoryMode"
  | "fixedCategoryId"
  | "fixedInflowToReadyToAssign"
  | "defaultCategoryId"
  | "defaultInflowToReadyToAssign";
export type PayeeFullRow = typeof payees.$inferSelect;
/** A payee as code builds it: the category columns are optional, the table's defaults fill them. */
export type PayeeRow = Omit<PayeeFullRow, CategoryCols> & Partial<Pick<PayeeFullRow, CategoryCols>>;
export type PayeeListRow = PayeeFullRow & {
  lastCategoryId: string | null;
  lastInflowToReadyToAssign: boolean;
  /** The fixed choice's category while it is live, else null (Ready to Assign is `fixedInflowToReadyToAssign`). */
  fixedLiveCategoryId: string | null;
  /** The history default: the stored value while live, else the read-time rule over the last 3 counted rows. */
  historyDefault: CategoryValue | null;
  transactionCount: number;
  scheduledCount: number;
  hasRules: boolean;
};

/** `col in (select value from json_each(?))`: any number of ids ride one bound parameter. */
export function idsIn(col: SQLWrapper, ids: readonly string[]): SQL {
  return sql`${col} in (select value from json_each(${JSON.stringify(ids)}))`;
}

/**
 * Non-deleted payees of the plan, with the category of each one's latest transaction. With `counts`, also how many
 * live transactions and scheduled transactions name each one (still one D1 call). `ids` narrows the rows.
 */
export async function listForPlan(
  db: Db,
  budgetId: string,
  opts: { includeHidden: boolean; counts?: boolean; ids?: readonly string[] },
): Promise<PayeeListRow[]> {
  return listRowsOf(await listForPlanQuery(db, budgetId, opts));
}

/** Unexecuted: the query of `listForPlan`, so it can ride a `db.batch` of reads; `listRowsOf` shapes its rows. */
export function listForPlanQuery(
  db: Db,
  budgetId: string,
  opts: { includeHidden: boolean; counts?: boolean; ids?: readonly string[] },
) {
  const conds = [eq(payees.budgetId, budgetId), isNull(payees.deletedAt)];
  if (!opts.includeHidden) conds.push(eq(payees.hidden, false));
  if (opts.ids) conds.push(idsIn(payees.id, opts.ids));
  const latestId = sql`(select t.id from transactions t
        where t.payee_id = payees.id and t.deleted_at is null and t.parent_transaction_id is null
        and not exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null)
        order by t.date desc, t.created_at desc, t.id desc limit 1)`;
  const tc = opts.counts
    ? sql<number>`(select count(*) from transactions t join accounts a on a.id = t.account_id and a.deleted_at is null
        where t.payee_id = payees.id and t.budget_id = ${budgetId} and t.deleted_at is null)`
    : sql<number>`0`;
  const sc = opts.counts
    ? sql<number>`(select count(*) from scheduled_transactions s join accounts a on a.id = s.account_id and a.deleted_at is null
        where s.payee_id = payees.id and s.budget_id = ${budgetId} and s.deleted_at is null)`
    : sql<number>`0`;
  const hr = opts.counts
    ? sql<number>`exists (select 1 from payee_rename_rules r where r.payee_id = payees.id and r.deleted_at is null)`
    : sql<number>`0`;
  const last3 = [0, 1, 2].map((n) => recentValueSql(budgetId, "payees.id", n));
  return db
    .select({
      p: payees,
      fixedLive: sql<
        string | null
      >`case when payees.fixed_category_id is not null and ${liveCategorySql(budgetId, "payees.fixed_category_id")} then payees.fixed_category_id end`,
      storedLive: sql<
        string | null
      >`case when payees.default_category_id is not null and ${liveCategorySql(budgetId, "payees.default_category_id")} then payees.default_category_id end`,
      v0: sql<string | null>`${last3[0]}`,
      v1: sql<string | null>`${last3[1]}`,
      v2: sql<string | null>`${last3[2]}`,
      live: sql<
        string | null
      >`(select c.id from categories c where c.id = (select category_id from transactions where id = ${latestId}) and c.deleted_at is null)`,
      rta: sql<number>`case when payees.system is null then coalesce((select inflow_to_ready_to_assign from transactions where id = ${latestId}), 0) else 0 end`,
      tc,
      sc,
      hr,
    })
    .from(payees)
    .where(and(...conds));
}

/** The rows `listForPlanQuery` read, as list rows. */
export function listRowsOf(rows: Awaited<ReturnType<typeof listForPlanQuery>>): PayeeListRow[] {
  return rows.map((r) => ({
    ...r.p,
    fixedLiveCategoryId: r.fixedLive ?? null,
    historyDefault: historyDefaultOf(r.p, r.storedLive, [r.v0, r.v1, r.v2]),
    lastCategoryId: r.live ?? null,
    lastInflowToReadyToAssign: Number(r.rta) === 1,
    transactionCount: Number(r.tc),
    scheduledCount: Number(r.sc),
    hasRules: Number(r.hr) === 1,
  }));
}

const parseValue = (j: string | null): CategoryValue | null => {
  if (j === null) return null;
  const v = JSON.parse(j) as { c: string | null; r: number };
  return { category_id: v.c, inflow_to_ready_to_assign: Number(v.r) === 1 };
};

/** The stored default while it is live (Ready to Assign always is), else the rule over the last 3 with no current. */
function historyDefaultOf(
  p: PayeeFullRow,
  storedLive: string | null,
  last3: (string | null)[],
): CategoryValue | null {
  if (p.defaultInflowToReadyToAssign) {
    return { category_id: null, inflow_to_ready_to_assign: true };
  }
  if (storedLive !== null) return { category_id: storedLive, inflow_to_ready_to_assign: false };
  return nextDefault(
    null,
    last3.map(parseValue).filter((v): v is CategoryValue => v !== null),
  );
}

export async function findActive(
  db: Db,
  budgetId: string,
  id: string,
): Promise<PayeeRow | undefined> {
  const [r] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.id, id), eq(payees.budgetId, budgetId), isNull(payees.deletedAt)))
    .limit(1);
  return r;
}

/** An ordinary (non-system) payee by its exact name. */
export async function findByName(
  db: Db,
  budgetId: string,
  name: string,
): Promise<PayeeRow | undefined> {
  const [r] = await findByNameQuery(db, budgetId, name);
  return r;
}

/** The unexecuted query of `findByName`, so it can ride a `db.batch` of reads. */
export function findByNameQuery(db: Db, budgetId: string, name: string) {
  return db
    .select()
    .from(payees)
    .where(
      and(
        eq(payees.budgetId, budgetId),
        eq(payees.name, name),
        isNull(payees.system),
        isNull(payees.deletedAt),
      ),
    )
    .limit(1);
}

export async function findSystem(
  db: Db,
  budgetId: string,
  system: PayeeSystem,
): Promise<PayeeRow | undefined> {
  const [r] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.budgetId, budgetId), eq(payees.system, system), isNull(payees.deletedAt)))
    .limit(1);
  return r;
}

export function insertStmt(db: Db, row: PayeeRow) {
  return db.insert(payees).values(row);
}

/** Inserts the payee only while `guard` holds. Column order is the table's. */
export function insertIfStmt(db: Db, row: PayeeRow, guard: SQLWrapper) {
  const r = row;
  return insertSelect(
    db,
    payees,
    {
      id: r.id,
      budgetId: r.budgetId,
      name: r.name,
      hidden: r.hidden ? 1 : 0,
      system: r.system,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    },
    sql`where exists ${guard}`,
  );
}

/** Inserts the system payee unless the plan already has one of that kind. */
export function insertSystemIfMissingStmt(db: Db, row: PayeeRow) {
  const r = row;
  return insertSelect(
    db,
    payees,
    {
      id: r.id,
      budgetId: r.budgetId,
      name: r.name,
      hidden: r.hidden ? 1 : 0,
      system: r.system,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    },
    sql`where not exists (select 1 from payees p where p.budget_id = ${r.budgetId} and p.system = ${r.system} and p.deleted_at is null)`,
  );
}

/** A scalar subquery for a `payee_id` column value: the plan's system payee of that kind. */
export function systemIdSql(budgetId: string, system: PayeeSystem) {
  return sql`(select p.id from payees p where p.budget_id = ${budgetId} and p.system = ${system} and p.deleted_at is null)`;
}

export function existsStmt(db: Db, id: string) {
  return db.select({ x: sql`1` }).from(payees).where(eq(payees.id, id));
}

export function isUniqueViolation(e: unknown): boolean {
  const msgs: string[] = [];
  for (let x: unknown = e; x instanceof Error; x = x.cause) msgs.push(x.message);
  return msgs.some((m) => m.includes("UNIQUE constraint failed: payees"));
}

/** Inserts the ordinary payee unless the plan has a live one with that name, and only while `guard` holds. */
export function insertByNameIfMissingStmt(db: Db, row: PayeeRow, guard: SQLWrapper) {
  const r = row;
  return insertSelect(
    db,
    payees,
    {
      id: r.id,
      budgetId: r.budgetId,
      name: r.name,
      hidden: r.hidden ? 1 : 0,
      system: r.system,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    },
    sql`where ${missingByNameSql(r.budgetId, r.name)} and exists ${guard}`,
  );
}

/** True while the plan has no live ordinary payee of that name (a condition, for `where`). */
export function missingByNameSql(budgetId: string, name: string): SQL {
  return sql`not exists (select 1 from payees p where p.budget_id = ${budgetId} and p.name = ${name} and p.system is null and p.deleted_at is null)`;
}

/** The same as a guard for `changeLogInsertIf`. */
export function missingByNameGuard(budgetId: string, name: string): SQLWrapper {
  return sql`(select 1 where ${missingByNameSql(budgetId, name)})`;
}

/** A scalar subquery for a `payee_id` value: the plan's live ordinary payee with that name. */
export function ordinaryIdByNameSql(budgetId: string, name: string): SQL {
  return sql`(select p.id from payees p where p.budget_id = ${budgetId} and p.name = ${name} and p.system is null and p.deleted_at is null)`;
}

/** A scalar subquery for a `payee_id` value: that payee's id while it is a live ordinary payee of the plan, else null. */
export function liveOrdinaryIdSql(budgetId: string, id: string): SQL {
  return sql`(select p.id from payees p where p.id = ${id} and p.budget_id = ${budgetId} and p.system is null and p.deleted_at is null)`;
}

const ordinaryAmong = (budgetId: string, ids: readonly string[]) =>
  sql`payees.budget_id = ${budgetId} and ${idsIn(sql`payees.id`, ids)} and payees.deleted_at is null and payees.system is null`;

/** A condition: all of `ids` are still live ordinary payees of the plan. */
export function liveOrdinaryCountSql(budgetId: string, ids: readonly string[]): SQL {
  return sql`(select count(*) from payees where ${ordinaryAmong(budgetId, ids)}) = ${ids.length}`;
}

/** A condition: `id` is a live ordinary payee of the plan. */
export function liveOrdinarySql(budgetId: string, id: string): SQL {
  return sql`exists (select 1 from payees where id = ${id} and budget_id = ${budgetId} and deleted_at is null and system is null)`;
}

export type PayeeCategoryFields = {
  categoryMode: PayeeFullRow["categoryMode"];
  fixedCategoryId: string | null;
  fixedInflowToReadyToAssign: boolean;
};

/** Renames, hides and/or sets the category choice of one payee, only while it still reads as `before`. */
export function updateStmt(
  db: Db,
  budgetId: string,
  id: string,
  patch: { name?: string; hidden?: boolean } & Partial<PayeeCategoryFields>,
  now: string,
  before: { name: string; hidden: boolean } & Partial<PayeeCategoryFields>,
  liveFixed: string | null = null,
) {
  return db
    .update(payees)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(payees.id, id), updateGuardSql(budgetId, id, before, liveFixed)));
}

/**
 * The guard of one payee update: the payee is live, ordinary and still reads as `before`, and the fixed category
 * the update sets (`liveFixed`) is still live (a race with its delete then writes nothing).
 */
export function updateGuardSql(
  budgetId: string,
  id: string,
  before: { name: string; hidden: boolean } & Partial<PayeeCategoryFields>,
  liveFixed: string | null = null,
): SQL {
  const live = liveFixed ? liveCategorySql(budgetId, sql`${liveFixed}`) : sql`1`;
  return sql`${unchangedSql(budgetId, id, before)} and ${live}`;
}

/** A condition: the payee is live, ordinary and still reads as `before`. */
export function unchangedSql(
  budgetId: string,
  id: string,
  before: { name: string; hidden: boolean } & Partial<PayeeCategoryFields>,
): SQL {
  const cat =
    before.categoryMode === undefined
      ? sql``
      : sql` and category_mode = ${before.categoryMode} and fixed_category_id is ${before.fixedCategoryId ?? null} and fixed_inflow_to_ready_to_assign = ${before.fixedInflowToReadyToAssign ? 1 : 0}`;
  return sql`exists (select 1 from payees where id = ${id} and budget_id = ${budgetId} and deleted_at is null and system is null and name = ${before.name} and hidden = ${before.hidden ? 1 : 0}${cat})`;
}

/** Sets `hidden` on the live ordinary payees among `ids` whose value differs, when `guard` holds. */
export function setHiddenStmt(
  db: Db,
  budgetId: string,
  ids: readonly string[],
  hidden: boolean,
  now: string,
  guard: SQL,
) {
  return db
    .update(payees)
    .set({ hidden, updatedAt: now })
    .where(sql`${ordinaryAmong(budgetId, ids)} and payees.hidden = ${hidden ? 0 : 1} and ${guard}`);
}

export function logHiddenStmt(
  db: Db,
  base: LogBase,
  budgetId: string,
  ids: readonly string[],
  hidden: boolean,
  guard: SQL,
) {
  const obj = (h: boolean) =>
    sql`json_object('id', id, 'name', name, 'hidden', json(${h ? "true" : "false"}))`;
  return logSelectStmt(
    db,
    base,
    sql`select id, name from payees where ${ordinaryAmong(budgetId, ids)} and hidden = ${hidden ? 0 : 1} and ${guard}`,
    { entityId: sql`id`, before: obj(!hidden), after: obj(hidden) },
  );
}

export function softDeleteStmt(
  db: Db,
  budgetId: string,
  ids: readonly string[],
  now: string,
  guard: SQL,
) {
  return db
    .update(payees)
    .set({ deletedAt: now, updatedAt: now })
    .where(sql`${ordinaryAmong(budgetId, ids)} and ${guard}`);
}

/** One `delete` history row per payee: before its name and counts, after the replacement and what moved. */
export function logDeleteStmt(
  db: Db,
  base: LogBase,
  budgetId: string,
  ids: readonly string[],
  replacementId: string | null,
  counts: Record<string, { t: number; s: number }>,
  guard: SQL,
) {
  const list = JSON.stringify(Object.entries(counts).map(([id, c]) => ({ id, ...c })));
  const num = (k: "t" | "s") =>
    sql`coalesce((select json_extract(j.value, ${`$.${k}`}) from json_each(${list}) j where json_extract(j.value, '$.id') = pid), 0)`;
  return logSelectStmt(
    db,
    base,
    sql`select id, id as pid, name, hidden from payees where ${ordinaryAmong(budgetId, ids)} and ${guard}`,
    {
      entityId: sql`id`,
      before: sql`json_object('id', id, 'name', name, 'hidden', json(case when hidden then 'true' else 'false' end), 'transaction_count', ${num("t")}, 'scheduled_count', ${num("s")})`,
      after: sql`json_object('id', id, 'deleted', json('true'), 'replacement_payee_id', ${replacementId}, 'transactions_moved', ${num("t")}, 'scheduled_moved', ${num("s")})`,
    },
  );
}

export type PayeeTransactionRow = {
  id: string;
  account_id: string;
  account_name: string;
  payee_name: string;
  date: string;
  category_id: string | null;
  category_name: string | null;
  inflow: number;
  is_split: number;
  memo: string | null;
  amount: number;
  created_at: string;
  total: number;
};

/** The live payees among `ids` in the plan, by one call (json_each, so the ids are one bound value). */
export function findActiveMany(db: Db, budgetId: string, ids: readonly string[]) {
  return db
    .select()
    .from(payees)
    .where(
      and(
        eq(payees.budgetId, budgetId),
        isNull(payees.deletedAt),
        sql`${payees.id} in (select value from json_each(${JSON.stringify(ids)}))`,
      ),
    );
}

/** Live transactions (parents and lines) of the payees, newest first, with the full count in `total`. */
export function transactionsOf(
  db: Db,
  budgetId: string,
  payeeIds: readonly string[],
  limit: number,
): Promise<PayeeTransactionRow[]> {
  return db.all<PayeeTransactionRow>(sql`
    select t.id, t.account_id, a.name as account_name, p.name as payee_name, t.date, t.category_id, c.name as category_name,
      t.inflow_to_ready_to_assign as inflow,
      exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null) as is_split,
      t.memo, t.amount, t.created_at, count(*) over () as total
    from transactions t
    join accounts a on a.id = t.account_id and a.deleted_at is null
    join payees p on p.id = t.payee_id
    left join categories c on c.id = t.category_id
    where t.budget_id = ${budgetId} and t.deleted_at is null
      and t.payee_id in (select value from json_each(${JSON.stringify(payeeIds)}))
    order by t.date desc, t.created_at desc, t.id
    limit ${limit}`);
}

export function scheduledOf(
  db: Db,
  budgetId: string,
  payeeIds: readonly string[],
  limit: number,
): Promise<PayeeTransactionRow[]> {
  return db.all<PayeeTransactionRow>(sql`
    select s.id, s.account_id, a.name as account_name, p.name as payee_name, s.date_next as date, s.category_id, c.name as category_name,
      s.inflow_to_ready_to_assign as inflow, 0 as is_split,
      s.memo, s.amount, s.created_at, count(*) over () as total
    from scheduled_transactions s
    join accounts a on a.id = s.account_id and a.deleted_at is null
    join payees p on p.id = s.payee_id
    left join categories c on c.id = s.category_id
    where s.budget_id = ${budgetId} and s.deleted_at is null
      and s.payee_id in (select value from json_each(${JSON.stringify(payeeIds)}))
    order by s.date_next desc, s.created_at desc, s.id
    limit ${limit}`);
}

/**
 * A statement for the end of a write batch: it fails the whole batch (NOT NULL on `change_log.actor`) unless every
 * given payee is still live, so a write that raced a payee's delete commits nothing. `isPayeeGone` recognises it.
 */
export function livePayeesCheck(
  db: Db,
  budgetId: string,
  ids: readonly (string | null | undefined)[],
) {
  const want = [...new Set(ids.filter((i): i is string => !!i))];
  if (want.length === 0) return [];
  return [
    insertSelect(
      db,
      changeLog,
      {
        id: sql`'payee-gone'`,
        budgetId,
        actor: sql`null`,
        action: sql`'update'`,
        entityType: sql`'payee'`,
        entityId: sql`'payee-gone'`,
        createdAt: sql`''`,
      },
      sql`where (select count(*) from payees where budget_id = ${budgetId} and deleted_at is null and ${idsIn(sql`payees.id`, want)}) < ${want.length}`,
    ),
  ];
}

export function isPayeeGone(e: unknown): boolean {
  for (let x: unknown = e; x instanceof Error; x = x.cause) {
    if (x.message.includes("NOT NULL constraint failed: change_log.actor")) return true;
  }
  return false;
}

/**
 * The last statement of a combine batch: it fails the whole batch (NOT NULL on `change_log.actor`) unless the survivor
 * is live under `name` and no merged payee is. `isPayeeGone` recognises it.
 */
export function combineCheckStmt(
  db: Db,
  budgetId: string,
  survivorId: string,
  name: string,
  mergedIds: readonly string[],
) {
  return insertSelect(
    db,
    changeLog,
    {
      id: sql`'payee-gone'`,
      budgetId,
      actor: sql`null`,
      action: sql`'update'`,
      entityType: sql`'payee'`,
      entityId: sql`'payee-gone'`,
      createdAt: sql`''`,
      changeSetId: currentChangeSetId(),
    },
    sql`where not (exists (select 1 from payees where id = ${survivorId} and budget_id = ${budgetId} and deleted_at is null and system is null and name = ${name})
      and (select count(*) from payees where budget_id = ${budgetId} and deleted_at is null and ${idsIn(sql`payees.id`, mergedIds)}) = 0)`,
  );
}
