import type { Month } from "@budget/core/month";
import type { FutureAssignedMonth } from "@budget/schema/months";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { usePlanMonth } from "../../shell/planPaths";
import { futureMonthLabel } from "./futureAssigned";
import { PanelCard } from "./PanelCard";

/** "Assigned in Future Months": the total over every later month, and a button per month that opens it. */
export function FutureAssignedCard({
  current,
  rows,
  total,
  collapsed,
  onToggle,
}: {
  current: Month;
  rows: readonly FutureAssignedMonth[];
  total: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const fmt = usePlanFormatter();
  const { setMonth } = usePlanMonth();
  return (
    <PanelCard
      id="panel-future-assigned"
      title="Assigned in Future Months"
      collapsed={collapsed}
      onToggle={onToggle}
      right={<span className="future-assigned-total">{fmt.money(total)}</span>}
    >
      {rows.map((r) => (
        <button
          key={r.month}
          type="button"
          className="future-month"
          onClick={() => setMonth(r.month)}
        >
          <svg
            className="future-month-icon"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="future-month-label">{futureMonthLabel(r.month, current)}</span>
          <span className="future-month-value">{fmt.money(r.assigned)}</span>
        </button>
      ))}
    </PanelCard>
  );
}
