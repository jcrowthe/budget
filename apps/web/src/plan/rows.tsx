// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are; the keys are the page's (shortcuts.ts)
import type { MonthCategoryDetail, MonthDetail, MonthGroupDetail } from "@budget/schema/months";
import { targetStatusText } from "@budget/schema/target-wording";
import { useEffect, useRef, useState } from "react";
import { AssignedCell, type CloseHow } from "./AssignedCell";
import { AvailablePill } from "./AvailablePill";
import {
  amountClass,
  categoryPill,
  money,
  plainSections,
  statusLabel,
  targetSections,
} from "./format";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightSmallIcon,
  PlusCircleFillIcon,
  QuestionCircleIcon,
  SubtractIcon,
} from "./icons";
import { PaymentHelpDialog } from "./PaymentHelpDialog";
import { ProgressBar } from "./ProgressBar";

/** A checkbox of the selection: checked, unchecked or "mixed" (some of the rows below it). */
export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean | "mixed";
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className="checkbox"
      onClick={onChange}
    >
      <span className="checkbox-box">
        {checked === true && <CheckIcon />}
        {checked === "mixed" && <SubtractIcon />}
      </span>
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
  checked,
  onCheck,
}: {
  /** A group with a `kind` (Credit Card Payments) belongs to the app: no edit popover, no add button. */
  g: MonthGroupDetail;
  checked: boolean | "mixed";
  onCheck: () => void;
  collapsed: boolean;
  onToggle: () => void;
  onEditName: (anchor: HTMLElement) => void;
  onAddCategory: (anchor: HTMLElement) => void;
  addOpen: boolean;
}) {
  const nameRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const locked = g.kind !== null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a right-click opens the edit popover; the name button does the same by keyboard
    <div
      className="grid-row group-row"
      role="row"
      aria-level={1}
      aria-expanded={!collapsed}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!locked && nameRef.current) onEditName(nameRef.current);
      }}
    >
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
        <Checkbox label={g.name} checked={checked} onChange={onCheck} />
      </div>
      <div className="cell-name" role="rowheader">
        {locked ? (
          <span className="group-name" title={g.name}>
            {g.name}
          </span>
        ) : (
          <>
            <button
              type="button"
              ref={nameRef}
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
          </>
        )}
      </div>
      <div className="num cell-assigned" role="cell">
        {money(g.assigned)}
      </div>
      <div className="num cell-activity" role="cell">
        {money(g.activity)}
      </div>
      <div className={`num cell-available${locked ? " has-payment-help" : ""}`} role="cell">
        {locked && (
          <button
            type="button"
            ref={helpRef}
            className="payment-help"
            aria-haspopup="dialog"
            onClick={() => setHelpOpen(true)}
          >
            <QuestionCircleIcon width={12} height={12} />
            PAYMENT
          </button>
        )}
        <span>{money(g.available)}</span>
      </div>
      <div className="cell-margin" />
      {helpOpen && (
        <PaymentHelpDialog
          onClose={() => {
            setHelpOpen(false);
            helpRef.current?.focus();
          }}
        />
      )}
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
  onSelect,
  onNameClick,
  onPill,
  selected,
  onContextMenu,
}: {
  c: MonthCategoryDetail;
  selected: boolean;
  onSelect: (how: "only" | "toggle") => void;
  /** A click on the name: the grid decides between selecting the row and opening its edit popover (EXF-592). */
  onNameClick: (anchor: HTMLElement) => void;
  /** Right-click: the row's edit popover, anchored at the name. */
  onContextMenu: (anchor: HTMLElement) => void;
  bars: boolean;
  editing: boolean;
  onOpen: () => void;
  onClose: (how: CloseHow, committed?: Promise<void>) => void;
  onCommit: (after: number) => Promise<void>;
  focusRequest: FocusTarget | null;
  onFocusDone: () => void;
  onPill: (anchor: HTMLElement) => void;
}) {
  const status = bars && c.target && c.available >= 0 ? targetStatusText(c) : null;
  const label = bars && !status ? statusLabel(c) : null;
  const pill = categoryPill(c);
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
    // biome-ignore lint/a11y/noStaticElementInteractions: a right-click opens the edit popover; the inspector's pencil does the same by keyboard
    <div
      className={`grid-row category-row${selected ? " is-selected" : ""}`}
      role="row"
      aria-level={2}
      aria-selected={selected}
      onContextMenu={(e) => {
        e.preventDefault();
        if (c.kind === null && nameRef.current) onContextMenu(nameRef.current);
      }}
    >
      <div className="cell-margin" />
      <div className="cell-collapse" />
      <div className="cell-checkbox">
        <Checkbox label={c.name} checked={selected} onChange={() => onSelect("toggle")} />
      </div>
      <div className="cell-name" role="rowheader">
        <div className="name-line">
          <button
            type="button"
            ref={nameRef}
            className="category-name"
            title={c.note ? `${c.name}\n${c.note}` : c.name}
            onClick={(e) => onNameClick(e.currentTarget)}
          >
            {c.name}
          </button>
          {status && (
            <span className="status-label" title={`${status.amount ?? ""}${status.text}`.trim()}>
              {status.amount && <strong>{status.amount}</strong>}
              {status.text}
            </span>
          )}
          {label && (
            <span className="status-label" title={label}>
              {label}
            </span>
          )}
        </div>
        {bars && c.kind === null && (
          <ProgressBar
            sections={c.target && c.available >= 0 ? targetSections(c) : plainSections(c)}
          />
        )}
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
        <AvailablePill
          ref={pillRef}
          amount={c.available}
          onOpen={onPill}
          tone={pill?.tone}
          icon={pill?.icon}
          title={pill?.title}
        />
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
