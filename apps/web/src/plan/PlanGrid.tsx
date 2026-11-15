// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are (EXF-498 adds keyboard selection)
import type { Month } from "@budget/core/month";
import { useEffect } from "react";
import { useMonth } from "../api/months";
import { useCollapsedGroups } from "./collapse";
import { ChevronDownIcon, ChevronRightSmallIcon } from "./icons";
import { useProgressBars } from "./progressBars";
import { CategoryRow, Checkbox, GroupRow, UncategorizedRow } from "./rows";
import { Toolbar } from "./Toolbar";
import "./plan-grid.css";

export function PlanGrid({ budgetId, month }: { budgetId: string; month: Month }) {
  const q = useMonth(budgetId, month);
  const data = q.data;
  const [bars, setBars] = useProgressBars();
  const { isCollapsed, setCollapsed } = useCollapsedGroups(budgetId, data?.groups);
  const groups = (data?.groups ?? []).filter((g) => !g.hidden);
  const ids = groups.map((g) => g.id);
  const allCollapsed = groups.length > 0 && groups.every((g) => isCollapsed(g.id));

  const idsKey = ids.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: idsKey stands for ids
  useEffect(() => {
    // EXF-473 moves this binding into the shortcut registry.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      setCollapsed(ids, e.key === "ArrowUp");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idsKey, setCollapsed]);

  const headerLabel = allCollapsed ? "Expand all" : "Collapse all";
  return (
    <section className={`plan-grid${bars ? " bars-on" : ""}`}>
      <div role="treegrid" aria-label="Plan" aria-busy={q.isPending}>
        <div className="grid-head" role="rowgroup">
          <Toolbar bars={bars} setBars={setBars} />
          <div className="grid-row header-row" role="row">
            <div className="cell-margin" />
            <div className="cell-collapse">
              <button
                type="button"
                className="collapse-button"
                aria-label={headerLabel}
                title={headerLabel}
                onClick={() => setCollapsed(ids, !allCollapsed)}
              >
                {allCollapsed ? <ChevronRightSmallIcon /> : <ChevronDownIcon />}
              </button>
            </div>
            <div className="cell-checkbox">
              <Checkbox label="Check all" />
            </div>
            <div className="cell-name" role="columnheader">
              <strong>CATEGORY</strong>
            </div>
            <div
              className="num"
              role="columnheader"
              title="Add money to each category in this column. This is the fun part. Until the money runs out."
            >
              <strong>ASSIGNED</strong>
            </div>
            <div
              className="num"
              role="columnheader"
              title={`It's the "We spent how much on WHAT?!" column.`}
            >
              <strong>ACTIVITY</strong>
            </div>
            <div
              className="num"
              role="columnheader"
              title="Do I have enough to buy that handmade didgeridoo? With this column, now you know."
            >
              <strong>AVAILABLE</strong>
            </div>
            <div className="cell-margin" />
          </div>
        </div>
        {q.isError && !data ? (
          <div className="grid-error" role="alert">
            <span>Couldn't load this month.</span>
            <button type="button" className="toolbar-button" onClick={() => q.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <div className="grid-body" role="rowgroup">
            {data?.uncategorized && <UncategorizedRow u={data.uncategorized} />}
            {groups.map((g) => {
              const collapsed = isCollapsed(g.id);
              return (
                <div key={g.id} className="group-block" role="presentation">
                  <GroupRow
                    g={g}
                    collapsed={collapsed}
                    onToggle={() => setCollapsed([g.id], !collapsed)}
                  />
                  {!collapsed &&
                    g.categories
                      .filter((c) => !c.hidden)
                      .map((c) => <CategoryRow key={c.id} c={c} bars={bars} />)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
