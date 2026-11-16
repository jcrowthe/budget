import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { reportSettings } from "../db/schema/report-settings";

export type ReportSettingsRow = typeof reportSettings.$inferSelect;

export async function list(db: Db, budgetId: string): Promise<ReportSettingsRow[]> {
  return db.select().from(reportSettings).where(eq(reportSettings.budgetId, budgetId));
}

/** UNEXECUTED statement for `db.batch`: inserts with defaults, or updates only the given columns. */
export function upsertStmt(
  db: Db,
  budgetId: string,
  report: string,
  set: Partial<Omit<ReportSettingsRow, "budgetId" | "report" | "updatedAt">>,
  now: string,
) {
  return db
    .insert(reportSettings)
    .values({ budgetId, report, ...set, updatedAt: now })
    .onConflictDoUpdate({
      target: [reportSettings.budgetId, reportSettings.report],
      set: { ...set, updatedAt: now },
    });
}

/** UNEXECUTED: sets the export-dialog flag on every row of the plan. */
export function setHideAllStmt(db: Db, budgetId: string, value: boolean, now: string) {
  return db
    .update(reportSettings)
    .set({ hideExportDialog: value, updatedAt: now })
    .where(eq(reportSettings.budgetId, budgetId));
}
