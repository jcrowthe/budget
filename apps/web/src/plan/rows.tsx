// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are (EXF-498 adds keyboard selection)
import type { MonthCategoryDetail, MonthDetail, MonthGroupDetail } from "@budget/schema/months";
import { useState } from "react";
import { PlusCircleIcon } from "../shell/icons";
import { AvailablePill } from "./AvailablePill";
import { barSegments, money, statusLabel } from "./format";
import { CheckIcon, ChevronDownIcon, ChevronRightSmallIcon } from "./icons";
import { ProgressBar } from "./ProgressBar";

/** Local visual state only: EXF-498 gives checkboxes their meaning. */
export function Checkbox({ label }: { label: string }) {
  const [checked, setChecked] = useState(false);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className="checkbox"
      onClick={() => setChecked((c) => !c)}
    >
      <span className="checkbox-box">{checked && <CheckIcon />}</span>
    </button>
  );
}

const amountClass = (n: number) => (n === 0 ? "amount zero" : "amount");

export function GroupRow({
  g,
  collapsed,
  onToggle,
}: {
  g: MonthGroupDetail;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="grid-row group-row" role="row" aria-level={1} aria-expanded={!collapsed}>
      <div className="cell-margin" />
      <div className="cell-collapse">
        <button
          type="button"
          className="collapse-button"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${g.name} categories`}
          onClick={onToggle}
        >
          {collapsed ? <ChevronRightSmallIcon /> : <ChevronDownIcon />}
        </button>
      </div>
      <div className="cell-checkbox">
        <Checkbox label={g.name} />
      </div>
      <div className="cell-name" role="rowheader">
        <span className="group-name" title={g.name}>
          {g.name}
        </span>
        {/* Inert until EXF-494 */}
        <button
          type="button"
          className="add-category"
          aria-label="Add Category"
          title="Add Category"
        >
          <PlusCircleIcon />
        </button>
      </div>
      <div className="num" role="cell">
        {money(g.assigned)}
      </div>
      <div className="num" role="cell">
        {money(g.activity)}
      </div>
      <div className="num" role="cell">
        {money(g.available)}
      </div>
      <div className="cell-margin" />
    </div>
  );
}

export function CategoryRow({ c, bars }: { c: MonthCategoryDetail; bars: boolean }) {
  const label = bars ? statusLabel(c) : null;
  return (
    <div className="grid-row category-row" role="row" aria-level={2}>
      <div className="cell-margin" />
      <div className="cell-collapse" />
      <div className="cell-checkbox">
        <Checkbox label={c.name} />
      </div>
      <div className="cell-name" role="rowheader">
        <div className="name-line">
          <span className="category-name" title={c.name}>
            {c.name}
          </span>
          {label && <span className="status-label">{label}</span>}
        </div>
        {bars && <ProgressBar segments={barSegments(c)} />}
      </div>
      <div className="cell-assigned" role="cell">
        {/* EXF-489 replaces this box with the input */}
        <div className="assigned-box">
          <span className={amountClass(c.assigned)}>{money(c.assigned)}</span>
        </div>
      </div>
      <div className="cell-activity" role="cell">
        <span className={amountClass(c.activity)}>{money(c.activity)}</span>
      </div>
      <div className="cell-available" role="cell">
        <AvailablePill amount={c.available} />
      </div>
      <div className="cell-margin" />
    </div>
  );
}

export function UncategorizedRow({ u }: { u: NonNullable<MonthDetail["uncategorized"]> }) {
  return (
    <div className="grid-row category-row uncategorized-row" role="row" aria-level={2}>
      <div className="cell-margin" />
      <div className="cell-collapse" />
      <div className="cell-checkbox" />
      <div className="cell-name" role="rowheader">
        <div className="name-line">
          <span className="category-name" title="Uncategorized Transactions">
            Uncategorized Transactions
          </span>
        </div>
      </div>
      <div className="cell-assigned" role="cell">
        <div className="assigned-box">
          <span className="amount">-</span>
        </div>
      </div>
      <div className="cell-activity" role="cell">
        <span className={amountClass(u.activity)}>{money(u.activity)}</span>
      </div>
      <div className="cell-available" role="cell">
        <AvailablePill amount={u.available} interactive={false} />
      </div>
      <div className="cell-margin" />
    </div>
  );
}
