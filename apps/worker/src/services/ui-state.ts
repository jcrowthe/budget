import {
  SidebarGroupName,
  UI_STATE_FIELDS,
  type UiState,
  UiStatePatch,
} from "@budget/schema/ui-state";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as uiStateRepo from "../repositories/ui-state";

/** Interface state is not plan data: no change_log row, no actor. */
export async function getUiState(env: Env, budgetId: string): Promise<UiState> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const out: Record<string, unknown> = {};
  for (const row of await uiStateRepo.list(db, budgetId)) {
    if (!Object.hasOwn(UI_STATE_FIELDS, row.key)) continue;
    try {
      const parsed = UI_STATE_FIELDS[row.key as keyof typeof UI_STATE_FIELDS].safeParse(
        JSON.parse(row.value),
      );
      if (parsed.success) out[row.key] = parsed.data;
    } catch {
      // bad JSON: skip
    }
  }
  return out as UiState;
}

export async function setUiState(env: Env, budgetId: string, patch: unknown): Promise<UiState> {
  const v = UiStatePatch.parse(patch);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const values: Record<string, unknown> = { ...v };
  if (v.collapsed_account_groups) {
    const set = new Set(v.collapsed_account_groups);
    values.collapsed_account_groups = SidebarGroupName.options.filter((g) => set.has(g));
  }
  const now = new Date().toISOString();
  const stmts = Object.entries(values)
    .filter(([, val]) => val !== undefined)
    .map(([k, val]) => uiStateRepo.upsertStmt(db, budgetId, k, JSON.stringify(val), now));
  const [first, ...rest] = stmts;
  if (first) await db.batch([first, ...rest]);
  return getUiState(env, budgetId);
}
