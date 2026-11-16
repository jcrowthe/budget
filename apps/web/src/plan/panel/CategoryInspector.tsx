import type { Month } from "@budget/core/month";
import type { MonthCategoryDetail } from "@budget/schema/months";
import { targetPill } from "@budget/schema/target-wording";
import type { ReactNode } from "react";
import { AvailablePill } from "../AvailablePill";
import { money, signed } from "../format";
import { PencilIcon } from "../icons";
import { NotesCard } from "./NotesCard";
import { PanelCard } from "./PanelCard";
import { PanelTooltip } from "./PanelTooltip";
import { TargetCard } from "./TargetCard";

/** One selected category: its name and pencil, the Available Balance, Target and Notes cards. */
export function CategoryInspector({
  budgetId,
  month,
  category: c,
  collapsed,
  onToggle,
  targetCollapsed,
  onToggleTarget,
  onEdit,
  autoAssign,
}: {
  budgetId: string;
  month: Month;
  targetCollapsed: boolean;
  onToggleTarget: () => void;
  category: MonthCategoryDetail;
  collapsed: boolean;
  onToggle: () => void;
  onEdit: (anchor: HTMLElement) => void;
  /** The Auto-Assign card, drawn between the Target and Notes cards. */
  autoAssign: ReactNode;
}) {
  // Credit card spending is not built (EXF-532): all of a category's activity is cash spending.
  const rows: [string, string][] = [
    ["Cash Left Over From Last Month", money(c.carried)],
    ["Assigned This Month", signed(c.assigned)],
    ["Cash Spending", signed(c.activity)],
    ["Credit Spending", signed(0)],
  ];
  const pill = c.target ? targetPill(c) : null;
  return (
    <>
      <div className="panel-heading">
        <h1 className="panel-title" title={c.name}>
          {c.name}
        </h1>
        <PanelTooltip text="Edit Category" align="end">
          {(trigger) => (
            <button
              type="button"
              {...trigger}
              className="panel-pencil"
              aria-label={`Edit category: ${c.name}`}
              onClick={(e) => onEdit(e.currentTarget)}
            >
              <PencilIcon />
            </button>
          )}
        </PanelTooltip>
      </div>
      <PanelCard
        id="panel-balance"
        title="Available Balance"
        collapsed={collapsed}
        onToggle={onToggle}
        right={<AvailablePill amount={c.available} display tone={pill?.tone} icon={pill?.icon} />}
      >
        {rows.map(([label, value]) => (
          <div key={label} className="panel-row">
            <span className="panel-row-label">{label}</span>
            <span className="panel-row-value" title={value}>
              {value}
            </span>
          </div>
        ))}
      </PanelCard>
      <TargetCard
        key={c.id}
        budgetId={budgetId}
        month={month}
        category={c}
        collapsed={targetCollapsed}
        onToggle={onToggleTarget}
      />
      {autoAssign}
      <NotesCard budgetId={budgetId} categoryId={c.id} note={c.note} />
    </>
  );
}
