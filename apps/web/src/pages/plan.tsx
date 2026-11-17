import type { Month } from "@budget/core/month";
import { overspentCount, type PlanView, viewCategories } from "@budget/schema/plan-views";
import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router";
import { useMonth } from "../api/months";
import { KeyboardTip } from "../plan/KeyboardTip";
import { type EditRequest, PlanGrid } from "../plan/PlanGrid";
import { PlanHeader } from "../plan/PlanHeader";
import { PlanPanel } from "../plan/panel/PlanPanel";
import { usePlanLayout } from "../plan/panel/planLayout";
import { useSelection, visibleSelection } from "../plan/selection";
import { ViewChips } from "../plan/ViewChips";
import { localCurrentMonth, planPath, rememberMonth, usePlanMonth } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

/** Everything below the URL logic. Keyed by plan, so the selection and every open editor reset on a plan switch. */
function PlanContent({ budgetId, month }: { budgetId: string; month: Month }) {
  const [selection, setSelection] = useSelection();
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const layout = usePlanLayout(bodyRef);
  const detail = useMonth(budgetId, month).data;
  // The chip in use is not saved: All after a reload or a plan switch, kept across months.
  const [view, setView] = useState<PlanView>("all");
  const viewAll = () => setView("all");
  // Overspent leaves with its last category (not compared with the source).
  useEffect(() => {
    if (view === "overspent" && detail && overspentCount(detail) === 0) setView("all");
  }, [view, detail]);
  // Every selectable category: what the view shows (not hidden, in a group that is not hidden).
  const all = detail ? viewCategories(detail, view).map((c) => c.id) : [];
  return (
    <div className="plan-page">
      <PlanHeader budgetId={budgetId} month={month} view={view} onViewAll={viewAll} />
      <ViewChips detail={detail} view={view} onView={setView} />
      <div className="plan-body" ref={bodyRef} {...layout}>
        <PlanGrid
          budgetId={budgetId}
          month={month}
          selection={selection}
          onSelection={setSelection}
          editRequest={editRequest}
          view={view}
          onViewAll={viewAll}
        />
        <PlanPanel
          budgetId={budgetId}
          month={month}
          selected={visibleSelection(selection, all)}
          view={view}
          onViewAll={viewAll}
          onView={setView}
          folded={"data-fold" in layout}
          onEditCategory={(id, anchor) => setEditRequest({ id, anchor, at: Date.now() })}
          bodyRef={bodyRef}
        />
      </div>
      <KeyboardTip />
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
