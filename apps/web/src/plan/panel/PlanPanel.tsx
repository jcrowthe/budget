import type { Month } from "@budget/core/month";
import { monthTotals, viewTotals } from "@budget/schema/month-totals";
import type { PlanView } from "@budget/schema/plan-views";
import { type RefObject, useRef, useState } from "react";
import { useFutureAssigned, useMonth, useMonthTargets } from "../../api/months";
import { localCurrentMonth } from "../../shell/planPaths";
import { useCurrentPlan } from "../../shell/useCurrentPlan";
import { AutoAssignCard } from "./AutoAssignCard";
import { CategoryInspector } from "./CategoryInspector";
import { CostToBeMe } from "./CostToBeMe";
import { FutureAssignedCard } from "./FutureAssignedCard";
import { usePanelWidth } from "./panelWidth";
import { ResizeHandle } from "./ResizeHandle";
import { SummaryCard } from "./SummaryCard";
import "./plan-panel.css";

/**
 * The right panel of the Plan page: the month summary with nothing selected, the selection summary with two
 * or more, the category inspector with one. Every figure is derived from the cached month, so the panel follows
 * optimistic edits at once and sends no request of its own, except the current month's Assigned in Future
 * Months card (docs/future-assigned-design.md). With no month loaded (first load, or a plan
 * switch) it shows nothing but its edge.
 */
export function PlanPanel({
  budgetId,
  month,
  selected,
  view,
  onViewAll,
  onView,
  onEditCategory,
  bodyRef,
  folded = false,
}: {
  budgetId: string;
  month: Month;
  /** The selected category ids that are still in the grid, in grid order. */
  selected: readonly string[];
  /** The Plan view in use: with nothing selected the summary and Auto-Assign cover what it shows. */
  view: PlanView;
  onViewAll: () => void;
  /** Switches the grid's view chip (Cover Overspent Categories). */
  onView: (v: PlanView) => void;
  /** The Plan body is too narrow for the panel (planLayout.ts): it is hidden. */
  folded?: boolean;
  onEditCategory: (id: string, anchor: HTMLElement) => void;
  bodyRef: RefObject<HTMLElement | null>;
}) {
  const detail = useMonth(budgetId, month).data;
  const [width, setWidth] = usePanelWidth();
  const [collapsed, setCollapsed] = useState({
    summary: false,
    balance: false,
    target: false,
    autoAssign: false,
    futureAssigned: false,
    paymentBalance: false,
    forPayment: true,
  });
  // EXF-527: only the current month with nothing selected; it reads the month summary once on its own.
  const showFuture = month === localCurrentMonth() && selected.length === 0;
  const future = useFutureAssigned(budgetId, month, showFuture).data;
  // EXF-525: Cost to Be Me, in the summary card with nothing selected, in every month.
  const targets = useMonthTargets(budgetId, month, selected.length === 0).data;
  const income = useCurrentPlan().plan?.expected_income ?? null;
  const panelRef = useRef<HTMLElement>(null);
  const all = detail?.groups.flatMap((g) => g.categories) ?? [];
  const one = selected.length === 1 ? all.find((c) => c.id === selected[0]) : undefined;
  const names = selected.map((id) => all.find((c) => c.id === id)?.name ?? "");
  const summary = detail && (
    <SummaryCard
      month={month}
      totals={selected.length > 0 ? monthTotals(detail, selected) : viewTotals(detail, view)}
      collapsed={collapsed.summary}
      onToggle={() => setCollapsed((c) => ({ ...c, summary: !c.summary }))}
    >
      {selected.length === 0 && targets && (
        <CostToBeMe
          budgetId={budgetId}
          month={month}
          total={targets.total}
          next={targets.next}
          income={income}
        />
      )}
    </SummaryCard>
  );
  const autoAssign = (
    <AutoAssignCard
      budgetId={budgetId}
      month={month}
      scope={selected.length > 0 ? { categoryIds: [...selected] } : { view }}
      collapsed={collapsed.autoAssign}
      onToggle={() => setCollapsed((c) => ({ ...c, autoAssign: !c.autoAssign }))}
      onViewAll={onViewAll}
    />
  );
  return (
    <aside
      ref={panelRef}
      className="plan-inspector"
      aria-label="Inspector"
      aria-busy={!detail}
      hidden={folded}
      style={{ "--panel-width": width === null ? "33%" : `${width}px` } as React.CSSProperties}
    >
      <ResizeHandle bodyRef={bodyRef} panelRef={panelRef} width={width} onWidth={setWidth} />
      {detail && (
        <div className="panel-content">
          {one ? (
            <CategoryInspector
              budgetId={budgetId}
              month={month}
              category={one}
              targetCollapsed={collapsed.target}
              onToggleTarget={() => setCollapsed((c) => ({ ...c, target: !c.target }))}
              collapsed={collapsed.balance}
              onToggle={() => setCollapsed((c) => ({ ...c, balance: !c.balance }))}
              onEdit={(anchor) => onEditCategory(one.id, anchor)}
              paymentCollapsed={{
                paymentBalance: collapsed.paymentBalance,
                forPayment: collapsed.forPayment,
              }}
              onTogglePayment={(k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }))}
              onView={onView}
              autoAssign={autoAssign}
            />
          ) : (
            <>
              {selected.length >= 2 && (
                <div className="panel-multi">
                  <h2 className="panel-title">{selected.length} Categories Selected</h2>
                  <p className="panel-names">{names.join(", ")}</p>
                </div>
              )}
              {summary}
              {autoAssign}
              {showFuture && future && (
                <FutureAssignedCard
                  current={month}
                  rows={future.rows}
                  total={future.total}
                  collapsed={collapsed.futureAssigned}
                  onToggle={() =>
                    setCollapsed((c) => ({ ...c, futureAssigned: !c.futureAssigned }))
                  }
                />
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
