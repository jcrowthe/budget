import { addMonths, type Month } from "@budget/core/month";
import type { MonthTotals } from "@budget/schema/months";
import { longMonth, money } from "../format";
import { PanelCard } from "./PanelCard";
import { PanelTooltip } from "./PanelTooltip";

/** "{Month}'s Summary": left over, assigned, activity and available over the categories in `totals`. */
export function SummaryCard({
  month,
  totals,
  collapsed,
  onToggle,
}: {
  month: Month;
  totals: MonthTotals;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const here = longMonth(month);
  const prev = longMonth(addMonths(month, -1));
  const rows: { label: string; value: number; tip: string; total?: boolean }[] = [
    {
      label: "Left Over from Last Month",
      value: totals.leftover,
      tip: `The total amount of money you have left over from ${prev}.`,
    },
    {
      label: `Assigned in ${here}`,
      value: totals.assigned,
      tip: `The total amount of money you have assigned in ${here}.`,
    },
    {
      label: "Activity",
      value: totals.activity,
      tip: `The total amount of activity (e.g. spending) in ${here}.`,
    },
    {
      label: "Available",
      value: totals.available,
      total: true,
      tip: `The total amount of money you have available in ${here}. Pro-tip: This includes money set aside for credit card payments and money left over from past months.`,
    },
  ];
  return (
    <PanelCard
      id="panel-summary"
      title={`${here}'s Summary`}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {rows.map((r) => (
        <PanelTooltip key={r.label} text={r.tip}>
          {(trigger) => (
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the row is focusable so its tooltip is reachable by keyboard
            <div {...trigger} tabIndex={0} className={`panel-row${r.total ? " is-total" : ""}`}>
              <span className="panel-row-label">{r.label}</span>
              <span className="panel-row-value">{money(r.value)}</span>
            </div>
          )}
        </PanelTooltip>
      ))}
    </PanelCard>
  );
}
