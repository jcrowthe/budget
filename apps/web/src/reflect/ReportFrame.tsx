import { resolveRange } from "@budget/schema/report-range";
import type { ReportSettingsUpdate, ReportSlug } from "@budget/schema/reports";
import { type ReactNode, useCallback, useState } from "react";
import { useParams } from "react-router";
import { localToday } from "../api/accounts";
import { useReportFacts, useReportSettings, useUpdateReportSettings } from "../api/reports";
import { AccountFilter } from "./AccountFilter";
import { CategoryFilter } from "./CategoryFilter";
import { DateRange } from "./DateRange";
import { ExportDialog } from "./ExportDialog";
import { FileTextIcon } from "./icons";
import { ReportTabs } from "./ReportTabs";
import { type ReportState, ReportStateContext } from "./state";
import "./reflect.css";

const HAS_CATEGORIES: readonly ReportSlug[] = [
  "spending-breakdown",
  "spending-trends",
  "income-expense",
];

export function ReportFrame({
  report,
  title,
  onExport,
  children,
}: {
  report: ReportSlug;
  title: string;
  /** Gets the frame's resolved state (range, filters), which the page cannot see. */
  onExport?: (state: ReportState) => Promise<void>;
  children: ReactNode;
}) {
  const { budgetId = "" } = useParams();
  const today = localToday();
  const settingsQuery = useReportSettings(budgetId);
  const factsQuery = useReportFacts(budgetId, today);
  const { mutate } = useUpdateReportSettings(budgetId);
  const [dialog, setDialog] = useState(false);
  const update = useCallback(
    (patch: ReportSettingsUpdate) => mutate({ report, patch }),
    [mutate, report],
  );
  const settings = settingsQuery.data?.reports.find((r) => r.report === report);
  const facts = factsQuery.data;
  const state: ReportState | null =
    settings && facts
      ? {
          budgetId,
          report,
          span: resolveRange(settings.preset, settings, facts),
          settings,
          facts,
          today,
          update,
        }
      : null;
  const isAge = report === "age-of-money";
  const run = () => {
    if (state) void onExport?.(state).catch(() => undefined);
  };
  return (
    <div className="reflect">
      <ReportTabs />
      <div className="reflect-head">
        <h1>{title}</h1>
        {!isAge && (
          <button
            type="button"
            className="export-button"
            disabled={!onExport || !state}
            onClick={() => (state?.settings.hide_export_dialog ? run() : setDialog(true))}
          >
            <FileTextIcon width={14} height={14} />
            Export
          </button>
        )}
      </div>
      {state && (
        <ReportStateContext.Provider value={state}>
          {!isAge && (
            <div className="filter-bar">
              <DateRange />
              <span className="filter-divider" aria-hidden="true" />
              {HAS_CATEGORIES.includes(report) && <CategoryFilter />}
              <AccountFilter />
            </div>
          )}
          <div className="reflect-body">{children}</div>
        </ReportStateContext.Provider>
      )}
      {dialog && (
        <ExportDialog
          onCancel={() => setDialog(false)}
          onExport={(dont) => {
            if (dont) update({ hide_export_dialog: true });
            setDialog(false);
            run();
          }}
        />
      )}
    </div>
  );
}
