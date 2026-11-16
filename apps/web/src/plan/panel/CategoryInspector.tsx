import type { MonthCategoryDetail } from "@budget/schema/months";
import { AvailablePill } from "../AvailablePill";
import { money, signed } from "../format";
import { PencilIcon } from "../icons";
import { NotesCard } from "./NotesCard";
import { PanelCard } from "./PanelCard";
import { PanelTooltip } from "./PanelTooltip";

/** One selected category: its name and pencil, the Available Balance card and the Notes card. */
export function CategoryInspector({
  budgetId,
  category: c,
  collapsed,
  onToggle,
  onEdit,
}: {
  budgetId: string;
  category: MonthCategoryDetail;
  collapsed: boolean;
  onToggle: () => void;
  onEdit: (anchor: HTMLElement) => void;
}) {
  // Credit card spending is not built (EXF-532): all of a category's activity is cash spending.
  const rows: [string, string][] = [
    ["Cash Left Over From Last Month", money(c.carried)],
    ["Assigned This Month", signed(c.assigned)],
    ["Cash Spending", signed(c.activity)],
    ["Credit Spending", signed(0)],
  ];
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
        right={<AvailablePill amount={c.available} display />}
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
      {/* Target (EXF-508, EXF-514) and Auto-Assign (EXF-519) go here. */}
      <NotesCard budgetId={budgetId} categoryId={c.id} note={c.note} />
    </>
  );
}
