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
  onEditName,
  onAddCategory,
  addOpen,
}: {
  g: MonthGroupDetail;
  collapsed: boolean;
  onToggle: () => void;
  onEditName: (anchor: HTMLElement) => void;
  onAddCategory: (anchor: HTMLElement) => void;
  addOpen: boolean;
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
        <button
          type="button"
          className="group-name"
          title={g.name}
          onClick={(e) => onEditName(e.currentTarget)}
        >
          {g.name}
        </button>
        <button
          type="button"
          className={`add-category${addOpen ? " active" : ""}`}
          aria-label="Add Category"
          title="Add Category"
          onClick={(e) => onAddCategory(e.currentTarget)}
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
  onEditName,
  onPill,
}: {
  c: MonthCategoryDetail;
  bars: boolean;
  editing: boolean;
  onOpen: () => void;
  onClose: (how: CloseHow, committed?: Promise<void>) => void;
  onCommit: (after: number) => Promise<void>;
  focusRequest: FocusTarget | null;
  onFocusDone: () => void;
  onEditName: (anchor: HTMLElement) => void;
  onPill: (anchor: HTMLElement) => void;
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
      <div
        className="cell-name"
        role="rowheader"
        onContextMenu={(e) => {
          e.preventDefault();
          if (nameRef.current) onEditName(nameRef.current);
        }}
      >
        <div className="name-line">
          {/* EXF-498: open the popover only when the row is already selected (the first click selects). */}
          <button
            type="button"
            ref={nameRef}
            className="category-name"
            title={c.name}
            onClick={(e) => onEditName(e.currentTarget)}
          >
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
        <AvailablePill ref={pillRef} amount={c.available} onOpen={onPill} />
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
