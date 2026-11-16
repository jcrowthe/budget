import { useState } from "react";
import { downloadSpendingTrendsZip } from "../api/reports";
import { ReportFrame } from "./ReportFrame";
import { SpendingTrendsReport } from "./SpendingTrendsReport";

export interface TrendsDrill {
  id: string;
  name: string;
}

/** Spending Trends owns the drill; a reload or another plan starts again from All Groups. */
export function SpendingTrendsPage({ title }: { title: string }) {
  const [drill, setDrill] = useState<TrendsDrill | null>(null);
  return (
    <ReportFrame
      report="spending-trends"
      title={title}
      categoryGroupId={drill?.id ?? null}
      heading={
        drill ? (
          <span className="sb-breadcrumb">
            <button type="button" className="sb-crumb" onClick={() => setDrill(null)}>
              All Groups
            </button>{" "}
            <span className="sb-crumb-sep" aria-hidden="true">
              ›
            </span>{" "}
            <span>{drill.name}</span>
          </span>
        ) : undefined
      }
      onExport={(s) =>
        downloadSpendingTrendsZip(
          s.budgetId,
          s.span,
          s.settings.excluded_category_ids,
          s.settings.excluded_account_ids,
          s.today,
        )
      }
    >
      <SpendingTrendsReport drill={drill} onDrill={setDrill} />
    </ReportFrame>
  );
}
