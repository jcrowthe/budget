import type { Month } from "@budget/core/month";
import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router";
import { useMonth } from "../api/months";
import { type EditRequest, PlanGrid } from "../plan/PlanGrid";
import { PlanHeader } from "../plan/PlanHeader";
import { PlanPanel } from "../plan/panel/PlanPanel";
import { useSelection, visibleSelection } from "../plan/selection";
import { localCurrentMonth, planPath, rememberMonth, usePlanMonth } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

/** Everything below the URL logic. Keyed by plan, so the selection and every open editor reset on a plan switch. */
function PlanContent({ budgetId, month }: { budgetId: string; month: Month }) {
  const [selection, setSelection] = useSelection();
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const detail = useMonth(budgetId, month).data;
  // Every selectable category: not hidden, in a group that is not hidden.
  const all = (detail?.groups ?? [])
    .filter((g) => !g.hidden)
    .flatMap((g) => g.categories.filter((c) => !c.hidden).map((c) => c.id));
  return (
    <div className="plan-page">
      <PlanHeader budgetId={budgetId} month={month} />
      {/* EXF-500: the view chips row goes here, between the header and the grid */}
      <div className="plan-body" ref={bodyRef}>
        <PlanGrid
          budgetId={budgetId}
          month={month}
          selection={selection}
          onSelection={setSelection}
          editRequest={editRequest}
        />
        <PlanPanel
          budgetId={budgetId}
          month={month}
          selected={visibleSelection(selection, all)}
          onEditCategory={(id, anchor) => setEditRequest({ id, anchor, at: Date.now() })}
          bodyRef={bodyRef}
        />
      </div>
    </div>
  );
}

function PlanPage() {
  const { budgetId, month: parsed } = usePlanMonth();
  const { month: raw } = useParams();
  // No month in the URL: the source keeps /budget and shows the current month (polish P2).
  const month = raw === undefined ? localCurrentMonth() : parsed;
  usePageTitle("Plan");
  useEffect(() => {
    if (month) rememberMonth(budgetId, month);
  }, [budgetId, month]);
  // A present but invalid month is replaced with the current month's canonical URL.
  if (!month) return <Navigate replace to={planPath(budgetId, localCurrentMonth())} />;
  return <PlanContent key={budgetId} budgetId={budgetId} month={month} />;
}

export const page = { path: "/:budgetId/budget/:month?", element: <PlanPage /> };
