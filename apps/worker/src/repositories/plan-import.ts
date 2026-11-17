import { type SQL, sql } from "drizzle-orm";
import type { BatchItem as DrizzleBatchItem } from "drizzle-orm/batch";
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

/** A JSON index, "b" (the plan's id) or a SQL literal; in the column order of the Drizzle table. */
type Col = number | "b" | { lit: string };
const lit = (s: string): Col => ({ lit: s });

const SPEC: Record<ImportTable, { cols: Col[]; json: readonly string[] }> = {
  accounts: {
    json: ["id", "name", "type", "on_budget", "sort_order", "created_at"],
    // id, budget_id, name, type, on_budget, note, starred, closed, sort_order, created_at, deleted_at, bank_account_id, import_start_date, last_reconciled_at
    cols: [
      0,
      "b",
      1,
      2,
      3,
      lit("null"),
      lit("0"),
      lit("0"),
      4,
      5,
      lit("null"),
      lit("null"),
      lit("null"),
      lit("null"),
    ],
  },
  category_groups: {
    json: ["id", "name", "sort_order", "kind", "created_at", "updated_at"],
    // id, budget_id, name, sort_order, hidden, collapsed, created_at, updated_at, deleted_at, kind
    cols: [0, "b", 1, 2, lit("0"), lit("0"), 4, 5, lit("null"), 3],
  },
  categories: {
    json: [
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
    // id, budget_id, group_id, name, sort_order, hidden, created_at, updated_at, deleted_at, note, kind, account_id
    cols: [0, "b", 1, 2, 3, 4, 7, 8, lit("null"), lit("null"), 5, 6],
  },
  payees: {
    json: ["id", "name", "system", "created_at", "updated_at"],
    // id, budget_id, name, hidden, system, created_at, updated_at, deleted_at
    cols: [0, "b", 1, lit("0"), 2, 3, 4, lit("null")],
  },
  month_categories: {
    json: ["month", "category_id", "assigned", "updated_at"],
    // budget_id, month, category_id, assigned, updated_at
    cols: ["b", 0, 1, 2, 3],
  },
  transactions: {
    json: [
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
    // id, budget_id, account_id, date, payee_name, category_id, inflow, memo, amount, cleared, approved, created_at,
    // deleted_at, updated_at, payee_id, transfer_account_id, transfer_transaction_id, parent_transaction_id,
    // split_index, import_id, source, imported_payee, bank_description, import_date, import_amount,
    // import_payee_name, flag_color
    cols: [
      0,
      "b",
      1,
      2,
      4,
      5,
      6,
      7,
      8,
      9,
      lit("1"),
      15,
      lit("null"),
      16,
      3,
      11,
      12,
      13,
      14,
      lit("null"),
      lit("null"),
      lit("null"),
      lit("null"),
      lit("null"),
      lit("null"),
      lit("null"),
      10,
    ],
  },
  scheduled_transactions: {
    json: [
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
    // id, budget_id, account_id, date_first, date_next, frequency, amount, payee_id, category_id, inflow, memo,
    // flag_color, write_token, created_at, updated_at, deleted_at
    cols: [0, "b", 1, 2, 3, lit("'never'"), 4, 5, 6, 7, 8, 9, 10, 11, 12, lit("null")],
  },
};

/** The JSON array order of each table's rows (the budget id is bound apart). */
export const IMPORT_COLUMNS: Record<ImportTable, readonly string[]> = Object.fromEntries(
  Object.entries(SPEC).map(([t, s]) => [t, s.json]),
) as Record<ImportTable, readonly string[]>;

const TABLES = {
  accounts,
  category_groups: categoryGroups,
  categories,
  payees,
  month_categories: monthCategories,
  transactions,
  scheduled_transactions: scheduledTransactions,
};

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
    const select = sql.join(
      spec.cols.map((c) =>
        c === "b"
          ? sql`${budgetId}`
          : typeof c === "number"
            ? sql`json_extract(j.value, ${`$[${c}]`})`
            : sql.raw(c.lit),
      ),
      sql`, `,
    );
    for (let i = 0; i < part.rows.length; i += perStatement) {
      const json = JSON.stringify(part.rows.slice(i, i + perStatement));
      out.push(
        db
          .insert(TABLES[part.t] as typeof accounts)
          .select(sql`select ${select} from json_each(${json}) j where ${g}`),
      );
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
  const del = (t: keyof typeof TABLES): BatchItem =>
    db.delete(TABLES[t] as typeof accounts).where(sql`budget_id = ${p.budgetId} and ${guard}`);
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
