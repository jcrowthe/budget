import { and, eq } from "drizzle-orm";
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
