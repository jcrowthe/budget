import { and, asc, eq, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accountImportSettings } from "../db/schema/account-import-settings";
import { accounts } from "../db/schema/accounts";
import { budgets } from "../db/schema/budgets";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { fileImports } from "../db/schema/file-imports";
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";
import { changeLogInsertIf } from "../history/change-log";
import { type LogBase, logSelectStmt } from "./guards";
import { insertSelect } from "./insert-select";
import { holdsAt, type LineRow, type TransactionRow, updateIfStmt } from "./transactions";

/**
 * File import's own statements (docs/file-import-design.md, "Worker (FI-2)"). Rows travel as positional JSON arrays,
 * one `json_each(?)` parameter per statement, so no statement has an IN list and the 100-bound-values limit never
 * applies. Each is "key not known" guarded in SQL: a concurrent import or reject between the reads and the batch
 * changes nothing twice. Every function returns an unexecuted statement.
 */
export type FileImportRow = typeof fileImports.$inferSelect;
export type SettingsRow = typeof accountImportSettings.$inferSelect;

export interface WriteCtx {
  budgetId: string;
  accountId: string;
  actor: string;
  now: string;
}

// ---------------------------------------------------------------------------------------------------- reads

export const fileRowQuery = (db: Db, id: string) =>
  db.select().from(fileImports).where(eq(fileImports.id, id)).limit(1);

/** Live rows past their expiry, oldest first, at most `limit`. */
export const sweepableQuery = (db: Db, now: string, limit: number) =>
  db
    .select()
    .from(fileImports)
    .where(and(isNull(fileImports.deletedAt), lt(fileImports.expiresAt, now)))
    .orderBy(asc(fileImports.expiresAt), asc(fileImports.id))
    .limit(limit);

/** The account's remembered options, one row per file format. */
export const settingsQuery = (db: Db, accountId: string) =>
  db.select().from(accountImportSettings).where(eq(accountImportSettings.accountId, accountId));

/** The live account of a live plan, with the plan's date format. */
export const accountForImportQuery = (db: Db, budgetId: string, accountId: string) =>
  db
    .select({
      id: accounts.id,
      type: accounts.type,
      closed: accounts.closed,
      importStartDate: accounts.importStartDate,
      planFormat: budgets.dateFormat,
    })
    .from(accounts)
    .innerJoin(budgets, and(eq(budgets.id, accounts.budgetId), isNull(budgets.deletedAt)))
    .where(
      and(eq(accounts.id, accountId), eq(accounts.budgetId, budgetId), isNull(accounts.deletedAt)),
    )
    .limit(1);

/** The account's live Starting Balance row (the earliest one), in full. */
export const startingBalanceRowQuery = (db: Db, accountId: string) =>
  db
    .select({ t: transactions })
    .from(transactions)
    .innerJoin(payees, eq(payees.id, transactions.payeeId))
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        eq(payees.system, "starting_balance"),
      ),
    )
    .orderBy(asc(transactions.date), asc(transactions.id))
    .limit(1);

/** A condition: no live row of the plan and no tombstone holds this import key. */
export const keyNotKnown = (budgetId: string, key: SQL): SQL =>
  sql`(not exists (select 1 from transactions where budget_id = ${budgetId} and import_id = ${key} and deleted_at is null) and not exists (select 1 from import_tombstones where budget_id = ${budgetId} and import_id = ${key}))`;

/** The keys (of the JSON array) that a live row or a tombstone of the plan already holds. */
export const knownKeysQuery = (db: Db, budgetId: string, keysJson: string) =>
  db
    .select({ key: sql<string>`j.value` })
    .from(sql`json_each(${keysJson}) j`)
    .where(sql`not ${keyNotKnown(budgetId, sql`j.value`)}`);

/** Date and amount of the live rows a Direct Import (the bank) made or matched, in the window. */
export const directRowsQuery = (db: Db, accountId: string, from: string, to: string) =>
  db
    .select({ id: transactions.id, date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        isNull(transactions.parentTransactionId),
        sql`${transactions.importId} is not null`,
        sql`(${transactions.source} = 'plaid' or (${transactions.source} is null and ${transactions.importId} not like 'file:%'))`,
        sql`${transactions.date} between ${from} and ${to}`,
      ),
    );

/** The live split lines of the hand rows an import may match (the parents `matchCandidatesQuery` returns). */
export const candidateLinesQuery = (db: Db, accountId: string, from: string, to: string) =>
  db
    .select({
      t: transactions,
      categoryName: categories.name,
      groupName: categoryGroups.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(
      and(
        isNull(transactions.deletedAt),
        sql`exists (select 1 from transactions p where p.id = ${transactions.parentTransactionId} and p.account_id = ${accountId} and p.deleted_at is null and p.import_id is null and p.source is null and p.date between ${from} and ${to})`,
      ),
    )
    .orderBy(transactions.parentTransactionId, transactions.splitIndex);

export const toLineRow = (r: {
  t: TransactionRow;
  categoryName: string | null;
  groupName: string | null;
}): LineRow => ({ ...r.t, categoryName: r.categoryName, groupName: r.groupName });

// ---------------------------------------------------------------------------------------------------- writes

const accountOpen = (c: WriteCtx): SQL =>
  sql`exists (select 1 from accounts a join budgets b on b.id = a.budget_id and b.deleted_at is null where a.id = ${c.accountId} and a.budget_id = ${c.budgetId} and a.deleted_at is null and a.closed = 0)`;

export const insertFileStmt = (db: Db, row: FileImportRow) => db.insert(fileImports).values(row);

/** Soft-deletes the swept files (JSON array of ids). */
export const sweepStmt = (db: Db, idsJson: string, now: string) =>
  db
    .update(fileImports)
    .set({ deletedAt: now })
    .where(
      and(
        isNull(fileImports.deletedAt),
        sql`exists (select 1 from json_each(${idsJson}) j where j.value = ${fileImports.id})`,
      ),
    );

/** Rows `[id, name]`: a payee per new name, unless the plan has a live ordinary one of that name by now. */
export const insertPayeesStmt = (db: Db, c: WriteCtx, json: string) =>
  insertSelect(
    db,
    payees,
    {
      id: sql`j.value->>0`,
      budgetId: c.budgetId,
      name: sql`j.value->>1`,
      hidden: sql`0`,
      system: sql`null`,
      createdAt: c.now,
      updatedAt: c.now,
    },
    sql`from json_each(${json}) j where not exists (select 1 from payees p where p.budget_id = ${c.budgetId} and p.name = j.value->>1 and p.system is null and p.deleted_at is null)`,
  );

/** The create log of the payees the statement above inserted (same rows, matched by id and creation time). */
export const payeeLogStmt = (db: Db, c: WriteCtx, json: string) =>
  logSelectStmt(
    db,
    logBase(c, "create", "payee"),
    sql`select p.id as id, p.name as name from json_each(${json}) j join payees p on p.id = j.value->>0 and p.created_at = ${c.now} and p.budget_id = ${c.budgetId}`,
    {
      entityId: sql`id`,
      before: null,
      after: sql`json_object('id', id, 'name', name, 'hidden', json('false'), 'system', null)`,
    },
  );

const logBase = (c: WriteCtx, action: LogBase["action"], entityType: string): LogBase => ({
  budgetId: c.budgetId,
  actor: c.actor,
  action,
  entityType,
  createdAt: c.now,
});

/**
 * Merge rows: `[id, updated_at, before, after, import_date, import_amount, import_memo, cleared]`, `before` and `after`
 * being the log shapes as JSON objects (the key, the bank's payee text and its name are read from `after`).
 */
const M = {
  id: sql`j.value->>0`,
  at: sql`j.value->>1`,
  before: sql`j.value->'$[2]'`,
  after: sql`j.value->'$[3]'`,
  key: sql`j.value->>'$[3].import_id'`,
};

const mergeWhere = (c: WriteCtx): SQL =>
  sql`${keyNotKnown(c.budgetId, M.key)} and ${accountOpen(c)}`;

/** Logs each merge, before its update (the guard rests on `updated_at`). */
export const mergeLogStmt = (db: Db, c: WriteCtx, json: string) =>
  logSelectStmt(
    db,
    logBase(c, "update", "transaction"),
    sql`select t.id as id, ${M.before} as before_json, ${M.after} as after_json from json_each(${json}) j join transactions t on t.id = ${M.id} and t.updated_at = ${M.at} and t.deleted_at is null and t.account_id = ${c.accountId} where ${mergeWhere(c)}`,
    { entityId: sql`id`, before: sql`before_json`, after: sql`after_json` },
  );

/** The split lines of a merged row follow it (cleared, approved), while the parent is as read. */
export const mergeLinesStmt = (db: Db, c: WriteCtx, json: string) =>
  db
    .update(transactions)
    .set({ cleared: sql`j.value->>7`, approved: sql`1`, updatedAt: c.now })
    .from(sql`json_each(${json}) j`)
    .where(
      sql`${transactions.parentTransactionId} = ${M.id} and ${transactions.deletedAt} is null and exists (select 1 from transactions p where p.id = ${M.id} and p.updated_at = ${M.at} and p.deleted_at is null and p.account_id = ${c.accountId}) and ${mergeWhere(c)}`,
    );

/** The merge itself: the bank columns, cleared and approved. The row's own write comes last (it moves updated_at). */
export const mergeUpdateStmt = (db: Db, c: WriteCtx, json: string) =>
  db
    .update(transactions)
    .set({
      importId: sql`j.value->>'$[3].import_id'`,
      importedPayee: sql`j.value->>'$[3].imported_payee'`,
      importDate: sql`j.value->>4`,
      importAmount: sql`j.value->>5`,
      importPayeeName: sql`j.value->>'$[3].import_payee_name'`,
      importMemo: sql`j.value->>6`,
      cleared: sql`j.value->>7`,
      approved: sql`1`,
      updatedAt: c.now,
    })
    .from(sql`json_each(${json}) j`)
    .where(
      sql`${transactions.id} = ${M.id} and ${transactions.updatedAt} = ${M.at} and ${transactions.deletedAt} is null and ${transactions.accountId} = ${c.accountId} and ${mergeWhere(c)}`,
    );

/**
 * Create rows: `[after, payee_id, import_memo]`, `after` the log shape of the new row as a JSON object (its id, date,
 * amount, memo, payee name, category, key and bank columns are read from it). A key a merge already took inserts nothing.
 */
const C = (path: string) => sql.raw(`j.value->>'$[0].${path}'`);

export const insertRowsStmt = (db: Db, c: WriteCtx, json: string) =>
  insertSelect(
    db,
    transactions,
    {
      id: C("id"),
      budgetId: c.budgetId,
      accountId: c.accountId,
      date: C("date"),
      payeeName: C("payee_name"),
      categoryId: C("category_id"),
      inflowToReadyToAssign: C("inflow_to_ready_to_assign"),
      memo: C("memo"),
      amount: C("amount"),
      cleared: sql`'cleared'`,
      approved: sql`0`,
      createdAt: c.now,
      updatedAt: c.now,
      payeeId: sql`coalesce((select p.id from payees p where p.id = j.value->>1 and p.budget_id = ${c.budgetId} and p.system is null and p.deleted_at is null), (select p.id from payees p where p.budget_id = ${c.budgetId} and p.name = ${C("payee_name")} and p.system is null and p.deleted_at is null))`,
      importId: C("import_id"),
      source: sql`'file'`,
      importedPayee: C("imported_payee"),
      importDate: C("date"),
      importAmount: C("amount"),
      importPayeeName: C("import_payee_name"),
      importMemo: sql`j.value->>2`,
    },
    sql`from json_each(${json}) j where ${keyNotKnown(c.budgetId, C("import_id"))} and ${accountOpen(c)}`,
  );

/** The create log of the rows the insert wrote, with the payee id the row ended up with. */
export const createLogStmt = (db: Db, c: WriteCtx, json: string) =>
  logSelectStmt(
    db,
    logBase(c, "create", "transaction"),
    sql`select t.id as id, json_set(j.value->'$[0]', '$.payee_id', t.payee_id) as after_json from json_each(${json}) j join transactions t on t.id = ${C("id")} and t.created_at = ${c.now} and t.budget_id = ${c.budgetId}`,
    { entityId: sql`id`, before: null, after: sql`after_json` },
  );

/** The Starting Balance moves to `date`: its log row first, then the update, both while the row is as read. */
export function startingBalanceMoveStmts(
  db: Db,
  c: WriteCtx,
  sb: TransactionRow,
  date: string,
  shapes: { before: unknown; after: unknown },
) {
  const guard = holdsAt(db, sb);
  return [
    changeLogInsertIf(
      db,
      {
        budgetId: c.budgetId,
        actor: c.actor,
        action: "update",
        entityType: "transaction",
        entityId: sb.id,
        before: shapes.before,
        after: shapes.after,
      },
      guard,
    ),
    updateIfStmt(db, sb.id, { date, updatedAt: c.now }, guard),
  ];
}

/** A first remembered-options row and its log row, only while none exists yet. */
export function settingsCreateStmts(
  db: Db,
  c: WriteCtx,
  format: SettingsRow["format"],
  options: unknown,
) {
  const none = sql`(select 1 where not exists (select 1 from account_import_settings where account_id = ${c.accountId} and format = ${format}) and ${accountOpen(c)})`;
  return [
    changeLogInsertIf(
      db,
      {
        budgetId: c.budgetId,
        actor: c.actor,
        action: "create",
        entityType: "account_import_settings",
        entityId: `${c.accountId}:${format}`,
        before: null,
        after: options,
      },
      none,
    ),
    insertSelect(
      db,
      accountImportSettings,
      {
        accountId: c.accountId,
        format,
        budgetId: c.budgetId,
        optionsJson: JSON.stringify(options),
        createdAt: c.now,
        updatedAt: c.now,
      },
      sql`where exists ${none}`,
    ),
  ];
}

/** New remembered options, only while the stored ones are still what was read. */
export function settingsUpdateStmts(
  db: Db,
  c: WriteCtx,
  format: SettingsRow["format"],
  was: SettingsRow,
  options: unknown,
) {
  const same = sql`(select 1 from account_import_settings where account_id = ${c.accountId} and format = ${format} and options_json = ${was.optionsJson})`;
  return [
    changeLogInsertIf(
      db,
      {
        budgetId: c.budgetId,
        actor: c.actor,
        action: "update",
        entityType: "account_import_settings",
        entityId: `${c.accountId}:${format}`,
        before: JSON.parse(was.optionsJson),
        after: options,
      },
      same,
    ),
    db
      .update(accountImportSettings)
      .set({ optionsJson: JSON.stringify(options), updatedAt: c.now })
      .where(
        and(
          eq(accountImportSettings.accountId, c.accountId),
          eq(accountImportSettings.format, format),
          eq(accountImportSettings.optionsJson, was.optionsJson),
        ),
      ),
  ];
}
