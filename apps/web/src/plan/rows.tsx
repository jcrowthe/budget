// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are (EXF-498 adds keyboard selection)
import type { MonthCategoryDetail, MonthDetail, MonthGroupDetail } from "@budget/schema/months";
import { useEffect, useRef, useState } from "react";
import { AssignedCell, type CloseHow } from "./AssignedCell";
import { AvailablePill } from "./AvailablePill";
import { amountClass, barSegments, money, statusLabel } from "./format";
import { CheckIcon, ChevronDownIcon, ChevronRightSmallIcon, PlusCircleFillIcon } from "./icons";
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
          <PlusCircleFillIcon />
        </button>
      </div>
      <div className="num cell-assigned" role="cell">
        {money(g.assigned)}
      </div>
      <div className="num cell-activity" role="cell">
        {money(g.activity)}
      </div>
      <div className="num cell-available" role="cell">
        {money(g.available)}
      </div>
      <div className="cell-margin" />
    </div>
  );
}

export type FocusTarget = "available" | "name";

export function CategoryRow({
  c,
  bars,
  editing,
  onOpen,
  onClose,
  onCommit,
  focusRequest,
  onFocusDone,
}: {
  c: MonthCategoryDetail;
  bars: boolean;
  editing: boolean;
  onOpen: () => void;
  onClose: (how: CloseHow, committed?: Promise<void>) => void;
  onCommit: (after: number) => Promise<void>;
  focusRequest: FocusTarget | null;
  onFocusDone: () => void;
}) {
  const label = bars ? statusLabel(c) : null;
  const nameRef = useRef<HTMLButtonElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: c.available re-runs it when a disabled pill becomes enabled
  useEffect(() => {
    if (focusRequest === "name") {
      nameRef.current?.focus();
      onFocusDone();
    } else if (focusRequest === "available" && pillRef.current && !pillRef.current.disabled) {
      pillRef.current.focus();
      onFocusDone();
    }
  }, [focusRequest, c.available, onFocusDone]);
  return (
    <div className="grid-row category-row" role="row" aria-level={2}>
      <div className="cell-margin" />
      <div className="cell-collapse" />
      <div className="cell-checkbox">
        <Checkbox label={c.name} />
      </div>
      <div className="cell-name" role="rowheader">
        <div className="name-line">
          {/* Inert until EXF-494's rename popover */}
          <button type="button" ref={nameRef} className="category-name" title={c.name}>
            {c.name}
          </button>
          {label && <span className="status-label">{label}</span>}
        </div>
        {bars && <ProgressBar segments={barSegments(c)} />}
      </div>
      <div className="cell-assigned" role="cell">
        <AssignedCell
          name={c.name}
          assigned={c.assigned}
          editing={editing}
          onOpen={onOpen}
          onClose={onClose}
          onCommit={onCommit}
        />
      </div>
      <div className="cell-activity" role="cell">
        <span className={amountClass(c.activity)}>{money(c.activity)}</span>
      </div>
      <div className="cell-available" role="cell">
        <AvailablePill ref={pillRef} amount={c.available} />
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
