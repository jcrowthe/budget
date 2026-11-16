import type { MonthSpan, RangeFacts } from "@budget/schema/report-range";
import type { ReportSettings, ReportSettingsUpdate, ReportSlug } from "@budget/schema/reports";
import { createContext, useContext } from "react";

export interface ReportState {
  budgetId: string;
  report: ReportSlug;
  /** The resolved, clamped range. */
  span: MonthSpan;
  settings: ReportSettings;
  facts: RangeFacts;
  /** The browser's local date, YYYY-MM-DD. */
  today: string;
  /** Set while a Spending Breakdown group is drilled: the category filter lists only that group. */
  categoryGroupId: string | null;
  update: (patch: ReportSettingsUpdate) => void;
}

export const ReportStateContext = createContext<ReportState | null>(null);

export function useReportState(): ReportState {
  const s = useContext(ReportStateContext);
  if (!s) throw new Error("useReportState outside ReportFrame");
  return s;
}
