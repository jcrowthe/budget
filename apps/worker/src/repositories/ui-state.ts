import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { uiState } from "../db/schema/ui-state";

export type UiStateRow = typeof uiState.$inferSelect;

export async function list(db: Db, budgetId: string): Promise<UiStateRow[]> {
  return db.select().from(uiState).where(eq(uiState.budgetId, budgetId));
}

/** UNEXECUTED statement for `db.batch`. */
export function upsertStmt(db: Db, budgetId: string, key: string, valueJson: string, now: string) {
  return db
    .insert(uiState)
    .values({ budgetId, key, value: valueJson, updatedAt: now })
    .onConflictDoUpdate({
      target: [uiState.budgetId, uiState.key],
      set: { value: valueJson, updatedAt: now },
    });
}
