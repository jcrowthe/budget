import {
  DEFAULT_PRESETS,
  type RangePreset,
  REPORT_SLUGS,
  type ReportSettings,
  type ReportSettingsList,
  ReportSettingsUpdate,
  ReportSlug,
} from "@budget/schema/reports";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as budgetsRepo from "../repositories/budgets";
import * as repo from "../repositories/report-settings";

function parseIds(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Interface state: no change_log row, like services/ui-state.ts. */
export async function getReportSettings(env: Env, budgetId: string): Promise<ReportSettingsList> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const rows = await repo.list(db, budgetId);
  const byReport = new Map(rows.map((r) => [r.report, r]));
  const hide = rows.some((r) => r.hideExportDialog);
  let last: { report: string; at: string } | null = null;
  for (const r of rows) {
    if (r.visitedAt && (!last || r.visitedAt > last.at))
      last = { report: r.report, at: r.visitedAt };
  }
  const reports: ReportSettings[] = REPORT_SLUGS.map((report) => {
    const row = byReport.get(report);
    const preset = (row?.preset as RangePreset | null | undefined) ?? DEFAULT_PRESETS[report];
    const custom = preset === "custom" && row?.startMonth && row.endMonth;
    return {
      report,
      preset,
      start_month: custom ? (row?.startMonth ?? null) : null,
      end_month: custom ? (row?.endMonth ?? null) : null,
      excluded_category_ids: row ? parseIds(row.excludedCategoryIds) : [],
      excluded_account_ids: row ? parseIds(row.excludedAccountIds) : [],
      hide_export_dialog: hide,
    };
  });
  const lastReport = last ? ReportSlug.safeParse(last.report) : null;
  return { last_report: lastReport?.success ? lastReport.data : null, reports };
}

export async function updateReportSettings(
  env: Env,
  budgetId: string,
  reportInput: string,
  patch: unknown,
): Promise<ReportSettingsList> {
  const report = ReportSlug.parse(reportInput);
  const v = ReportSettingsUpdate.parse(patch);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const now = new Date().toISOString();
  const set: Parameters<typeof repo.upsertStmt>[3] = {};
  if (v.preset !== undefined) {
    set.preset = v.preset;
    set.startMonth = v.preset === "custom" ? (v.start_month ?? null) : null;
    set.endMonth = v.preset === "custom" ? (v.end_month ?? null) : null;
  }
  if (v.excluded_category_ids)
    set.excludedCategoryIds = JSON.stringify([...new Set(v.excluded_category_ids)]);
  if (v.excluded_account_ids)
    set.excludedAccountIds = JSON.stringify([...new Set(v.excluded_account_ids)]);
  if (v.hide_export_dialog !== undefined) set.hideExportDialog = v.hide_export_dialog;
  if (v.visited) set.visitedAt = now;
  const stmts = [repo.upsertStmt(db, budgetId, report, set, now)];
  if (v.hide_export_dialog !== undefined) {
    stmts.push(repo.setHideAllStmt(db, budgetId, v.hide_export_dialog, now) as never);
  }
  await db.batch(stmts as [(typeof stmts)[0], ...(typeof stmts)[0][]]);
  return getReportSettings(env, budgetId);
}
