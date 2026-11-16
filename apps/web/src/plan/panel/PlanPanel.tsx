import type { Month } from "@budget/core/month";
import { monthTotals } from "@budget/schema/month-totals";
import { type RefObject, useRef, useState } from "react";
import { useMonth } from "../../api/months";
import { CategoryInspector } from "./CategoryInspector";
import { usePanelWidth } from "./panelWidth";
import { ResizeHandle } from "./ResizeHandle";
import { SummaryCard } from "./SummaryCard";
import "./plan-panel.css";

/**
 * The right panel of the Plan page: the month summary with nothing selected, the selection summary with two
 * or more, the category inspector with one. Every figure is derived from the cached month, so the panel follows
 * optimistic edits at once and sends no request of its own. With no month loaded (first load, or a plan
 * switch) it shows nothing but its edge.
 */
export function PlanPanel({
  budgetId,
  month,
  selected,
  onEditCategory,
  bodyRef,
}: {
  budgetId: string;
  month: Month;
  /** The selected category ids that are still in the grid, in grid order. */
  selected: readonly string[];
  onEditCategory: (id: string, anchor: HTMLElement) => void;
  bodyRef: RefObject<HTMLElement | null>;
}) {
  const detail = useMonth(budgetId, month).data;
  const [width, setWidth] = usePanelWidth();
  const [collapsed, setCollapsed] = useState({ summary: false, balance: false, target: false });
  const panelRef = useRef<HTMLElement>(null);
  const all = detail?.groups.flatMap((g) => g.categories) ?? [];
  const one = selected.length === 1 ? all.find((c) => c.id === selected[0]) : undefined;
  const names = selected.map((id) => all.find((c) => c.id === id)?.name ?? "");
  const summary = detail && (
    <SummaryCard
      month={month}
      totals={monthTotals(detail, selected.length > 0 ? selected : undefined)}
      collapsed={collapsed.summary}
      onToggle={() => setCollapsed((c) => ({ ...c, summary: !c.summary }))}
    />
  );
  return (
    <aside
      ref={panelRef}
      className="plan-inspector"
      aria-label="Inspector"
      aria-busy={!detail}
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
            </>
          )}
        </div>
      )}
    </aside>
  );
}
