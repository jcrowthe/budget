import type { SpendingGroupBy } from "@budget/schema/reports";
import { useState } from "react";
import { downloadSpendingBreakdownZip } from "../api/reports";
import { ReportFrame } from "./ReportFrame";
import { SpendingBreakdownReport } from "./SpendingBreakdownReport";

export interface Drill {
  id: string;
  name: string;
}

/** Spending Breakdown owns the toggle and the drill; a reload or another plan starts again from Categories. */
export function SpendingBreakdownPage({ title }: { title: string }) {
  const [mode, setMode] = useState<SpendingGroupBy>("category");
  const [drill, setDrill] = useState<Drill | null>(null);
  return (
    <ReportFrame
      report="spending-breakdown"
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
        downloadSpendingBreakdownZip(
          s.budgetId,
          s.span,
          s.settings.excluded_category_ids,
          s.settings.excluded_account_ids,
          s.today,
        )
      }
    >
      <SpendingBreakdownReport mode={mode} drill={drill} onMode={setMode} onDrill={setDrill} />
    </ReportFrame>
  );
}
