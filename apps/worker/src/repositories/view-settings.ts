import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { uiState } from "../db/schema/ui-state";

/** The `ui_state` key of an account's view settings, or of All Accounts (`all_accounts`). */
export const viewSettingsKey = (scope: string) => `view_settings:${scope}`;

/** The stored JSON, one select by primary key. */
export async function find(db: Db, budgetId: string, key: string): Promise<string | undefined> {
  const [row] = await db
    .select({ value: uiState.value })
    .from(uiState)
    .where(and(eq(uiState.budgetId, budgetId), eq(uiState.key, key)))
    .limit(1);
  return row?.value;
}

const rowIs = (budgetId: string, key: string, value: string | undefined) =>
  value === undefined
    ? sql`(select 1 where not exists (select 1 from ui_state where budget_id = ${budgetId} and key = ${key}))`
    : sql`(select 1 from ui_state where budget_id = ${budgetId} and key = ${key} and value = ${value})`;

/** True in the guard's SQL while the stored value is still the one that was read (`undefined`: still no row). */
export const unchangedGuard = rowIs;

/**
 * UNEXECUTED statement: writes `valueJson` only while the stored value is still `expected` (the one that was
 * read; `undefined` means there was no row). Put the change_log insert with the same guard BEFORE it in the batch.
 */
export function writeIfStmt(
  db: Db,
  budgetId: string,
  key: string,
  valueJson: string,
  now: string,
  expected: string | undefined,
) {
  if (expected === undefined) {
    return db
      .insert(uiState)
      .values({ budgetId, key, value: valueJson, updatedAt: now })
      .onConflictDoNothing();
  }
  return db
    .update(uiState)
    .set({ value: valueJson, updatedAt: now })
    .where(and(eq(uiState.budgetId, budgetId), eq(uiState.key, key), eq(uiState.value, expected)));
}
