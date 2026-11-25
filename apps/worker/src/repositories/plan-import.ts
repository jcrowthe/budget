import { getTableColumns, type InferInsertModel, type SQL, sql } from "drizzle-orm";
import type { BatchItem as DrizzleBatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { budgets } from "../db/schema/budgets";
import { categories } from "../db/schema/categories";
import { categoryGroups } from "../db/schema/category-groups";
import { monthCategories } from "../db/schema/month-categories";
import { payees } from "../db/schema/payees";
import { planImports } from "../db/schema/plan-imports";
import { scheduledTransactions } from "../db/schema/scheduled-transactions";
import { transactions } from "../db/schema/transactions";
import { type ChangeLogEntry, changeLogInsertIf } from "../history/change-log";
import type * as budgetsRepo from "./budgets";
import { insertSelect } from "./insert-select";

type BatchItem = DrizzleBatchItem<"sqlite">;
export type PlanImportRow = typeof planImports.$inferSelect;

/**
 * Import Plan's own statements (docs/plan-import-design.md). Rows travel as positional JSON arrays and are
 * inserted with set statements (`insert ... select ... from json_each(?)`): a statement holds one JSON parameter,
 * so the 100-bound-values limit never applies. Every statement of a step is guarded by "this import is still
 * writing and its next chunk is this one", so a repeated or concurrent step writes nothing the second time.
 */
export type ImportTable =
  | "accounts"
  | "category_groups"
  | "categories"
  | "payees"
  | "month_categories"
  | "transactions"
  | "scheduled_transactions";

/** A JSON index, "b" (the plan's id) or a SQL literal. */
type Val = number | "b" | { lit: string };
const lit = (s: string): Val => ({ lit: s });

type Spec = { table: SQLiteTable; json: readonly string[]; cols: Record<string, Val> };

/** One table's entry: the Drizzle table, its JSON row order, and each written column paired with its value. A
 * column that is not named takes its SQL default; an unknown property fails the type check. */
function spec<T extends SQLiteTable>(
  table: T,
  json: readonly string[],
  cols: { [K in keyof InferInsertModel<T>]?: Val },
): Spec {
  return { table, json, cols: cols as Record<string, Val> };
}

const SPEC: Record<ImportTable, Spec> = {
  accounts: spec(
    accounts,
    [
      "id",
      "name",
      "type",
      "on_budget",
      "sort_order",
      "created_at",
      "interest_rate",
      "minimum_payment",
      "escrow_amount",
      "paired_category_id",
    ],
    {
      id: 0,
      budgetId: "b",
      name: 1,
      type: 2,
      onBudget: 3,
      starred: lit("0"),
      closed: lit("0"),
      sortOrder: 4,
      createdAt: 5,
      interestRate: 6,
      minimumPayment: 7,
      escrowAmount: 8,
      pairedCategoryId: 9,
    },
  ),
  category_groups: spec(
    categoryGroups,
    ["id", "name", "sort_order", "kind", "created_at", "updated_at"],
    {
      id: 0,
      budgetId: "b",
      name: 1,
      sortOrder: 2,
      hidden: lit("0"),
      collapsed: lit("0"),
      createdAt: 4,
      updatedAt: 5,
      kind: 3,
    },
  ),
  categories: spec(
    categories,
    [
      "id",
      "group_id",
      "name",
      "sort_order",
      "hidden",
      "kind",
      "account_id",
      "created_at",
      "updated_at",
    ],
    {
      id: 0,
      budgetId: "b",
      groupId: 1,
      name: 2,
      sortOrder: 3,
      hidden: 4,
      createdAt: 7,
      updatedAt: 8,
      kind: 5,
      accountId: 6,
    },
  ),
  payees: spec(payees, ["id", "name", "system", "created_at", "updated_at"], {
    id: 0,
    budgetId: "b",
    name: 1,
    hidden: lit("0"),
    system: 2,
    createdAt: 3,
    updatedAt: 4,
  }),
  month_categories: spec(monthCategories, ["month", "category_id", "assigned", "updated_at"], {
    budgetId: "b",
    month: 0,
    categoryId: 1,
    assigned: 2,
    updatedAt: 3,
  }),
  transactions: spec(
    transactions,
    [
      "id",
      "account_id",
      "date",
      "payee_id",
      "payee_name",
      "category_id",
      "inflow_to_ready_to_assign",
      "memo",
      "amount",
      "cleared",
      "flag_color",
      "transfer_account_id",
      "transfer_transaction_id",
      "parent_transaction_id",
      "split_index",
      "created_at",
      "updated_at",
    ],
    {
      id: 0,
      budgetId: "b",
      accountId: 1,
      date: 2,
      payeeName: 4,
      categoryId: 5,
      inflowToReadyToAssign: 6,
      memo: 7,
      amount: 8,
      cleared: 9,
      approved: lit("1"),
      createdAt: 15,
      updatedAt: 16,
      payeeId: 3,
      transferAccountId: 11,
      transferTransactionId: 12,
      parentTransactionId: 13,
      splitIndex: 14,
      flagColor: 10,
    },
  ),
  scheduled_transactions: spec(
    scheduledTransactions,
    [
      "id",
      "account_id",
      "date_first",
      "date_next",
      "amount",
      "payee_id",
      "category_id",
      "inflow_to_ready_to_assign",
      "memo",
      "flag_color",
      "write_token",
      "created_at",
      "updated_at",
    ],
    {
      id: 0,
      budgetId: "b",
      accountId: 1,
      dateFirst: 2,
      dateNext: 3,
      frequency: lit("'never'"),
      amount: 4,
      payeeId: 5,
      categoryId: 6,
      inflowToReadyToAssign: 7,
      memo: 8,
      flagColor: 9,
      writeToken: 10,
      createdAt: 11,
      updatedAt: 12,
    },
  ),
};

/** The SQL names of the columns the import writes into a table. */
export function importColumnNames(t: ImportTable): string[] {
  const cols = getTableColumns(SPEC[t].table) as Record<string, { name: string }>;
  return Object.keys(SPEC[t].cols).map((k) => cols[k]?.name as string);
}

/** The JSON array order of each table's rows (the budget id is bound apart). */
export const IMPORT_COLUMNS: Record<ImportTable, readonly string[]> = Object.fromEntries(
  Object.entries(SPEC).map(([t, s]) => [t, s.json]),
) as Record<ImportTable, readonly string[]>;

export type ChunkPart = { t: ImportTable; rows: unknown[][] };
/** null on the single-call path (nothing to guard: the batch is the whole import). */
export type Guard = { importId: string; chunk: number } | null;

/** True while the import is writing and this is its next chunk. */
function guardSql(g: Guard): SQL {
  return g
    ? sql`(select next_chunk from plan_imports where id = ${g.importId} and state = 'writing') = ${g.chunk}`
    : sql`1`;
}
const existsGuard = (importId: string, chunk: number): SQL =>
  sql`(select 1 from plan_imports where id = ${importId} and state = 'writing' and next_chunk = ${chunk})`;

export function insertRowsStmts(
  db: Db,
  budgetId: string,
  parts: ChunkPart[],
  guard: Guard,
  perStatement = 250,
): BatchItem[] {
  const out: BatchItem[] = [];
  const g = guardSql(guard);
  for (const part of parts) {
    const spec = SPEC[part.t];
    const values = Object.fromEntries(
      Object.entries(spec.cols).map(([k, c]) => [
        k,
        c === "b"
          ? sql`${budgetId}`
          : typeof c === "number"
            ? sql`json_extract(j.value, ${`$[${c}]`})`
            : sql.raw(c.lit),
      ]),
    );
    for (let i = 0; i < part.rows.length; i += perStatement) {
      const json = JSON.stringify(part.rows.slice(i, i + perStatement));
      out.push(insertSelect(db, spec.table, values, sql`from json_each(${json}) j where ${g}`));
    }
  }
  return out;
}

/** The plan's own row; `deletedAt` set means hidden. */
export function insertPlanStmt(db: Db, row: budgetsRepo.BudgetRow): BatchItem {
  return db.insert(budgets).values(row);
}

export function insertImportStmt(db: Db, row: PlanImportRow): BatchItem {
  return db.insert(planImports).values(row);
}

/** The last step: the history entry and the plan becomes visible, both under the step's guard. */
export function revealStmts(
  db: Db,
  p: { importId: string; chunk: number; budgetId: string; now: string; log: ChangeLogEntry },
): BatchItem[] {
  const guard = existsGuard(p.importId, p.chunk);
  return [
    changeLogInsertIf(db, p.log, guard),
    db
      .update(budgets)
      .set({ deletedAt: null, updatedAt: p.now })
      .where(sql`id = ${p.budgetId} and deleted_at is not null and exists ${guard}`),
  ];
}

/** Goes last in a step's batch: moves the import to its next chunk, or to done. */
export function advanceStmt(
  db: Db,
  importId: string,
  chunk: number,
  now: string,
  finish: boolean,
): BatchItem {
  return db
    .update(planImports)
    .set({
      nextChunk: chunk + 1,
      updatedAt: now,
      ...(finish ? { state: "done" as const, finishedAt: now } : {}),
    })
    .where(sql`id = ${importId} and state = 'writing' and next_chunk = ${chunk}`);
}

/**
 * Removes everything of an unfinished import: each delete is guarded by "the import is still writing and the
 * plan is still hidden", so it can never match a visible plan.
 */
export function cleanupStmts(
  db: Db,
  p: { importId: string; budgetId: string; now: string },
): BatchItem[] {
  const guard = sql`exists (select 1 from plan_imports where id = ${p.importId} and budget_id = ${p.budgetId} and state = 'writing') and exists (select 1 from budgets where id = ${p.budgetId} and deleted_at is not null)`;
  const del = (t: ImportTable): BatchItem =>
    db.delete(SPEC[t].table as typeof accounts).where(sql`budget_id = ${p.budgetId} and ${guard}`);
  return [
    del("scheduled_transactions"),
    del("transactions"),
    del("month_categories"),
    del("categories"),
    del("category_groups"),
    del("payees"),
    del("accounts"),
    db.delete(budgets).where(sql`id = ${p.budgetId} and ${guard}`),
    db
      .update(planImports)
      .set({ state: "abandoned", summaryJson: "{}", chunkOffsets: "[]", updatedAt: p.now })
      .where(sql`id = ${p.importId} and state = 'writing'`),
  ];
}

export function clearKeyStmt(db: Db, importId: string): BatchItem {
  return db.update(planImports).set({ r2Key: null }).where(sql`id = ${importId}`);
}

export async function find(db: Db, importId: string): Promise<PlanImportRow | undefined> {
  const [row] = await db.select().from(planImports).where(sql`id = ${importId}`).limit(1);
  return row;
}

/** The oldest import to clean: writing and untouched since `staleBefore`, or done with its file still kept. */
export async function findSweepable(
  db: Db,
  p: { staleBefore: string; keyBefore: string },
): Promise<PlanImportRow | undefined> {
  const [row] = await db
    .select()
    .from(planImports)
    .where(
      sql`(state = 'writing' and updated_at < ${p.staleBefore}) or (state = 'done' and r2_key is not null and updated_at < ${p.keyBefore})`,
    )
    .orderBy(planImports.updatedAt)
    .limit(1);
  return row;
}
