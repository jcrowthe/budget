import { addMonths, type Month } from "@budget/core/month";
import type { MonthCategoryDetail, MonthDetail } from "@budget/schema/months";
import { READY_TO_ASSIGN } from "@budget/schema/moves";
import { useMemo, useState } from "react";
import { useMonth, useMonthList, useMonthRange } from "../api/months";
import type { MoveRequest } from "../api/moves";
import { CategoryPicker } from "./CategoryPicker";
import { monthLabel } from "./monthNav";
import { CaretDownIcon } from "./monthNavIcons";
import { Popover } from "./Popover";

const MAX_AHEAD = 120;
const positive = (c: MonthCategoryDetail) => c.available > 0;

/** A drop-down of our own (a native select's rows cannot be reached by a real mouse in every browser). */
function MonthDropdown({
  options,
  value,
  onChange,
}: {
  options: Month[];
  value: Month;
  onChange: (m: Month) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const pick = (m: Month) => {
    setOpen(false);
    onChange(m);
  };
  return (
    <div className="month-dropdown">
      <button
        type="button"
        className="month-dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Month"
        onClick={() => {
          setActive(Math.max(0, options.indexOf(value)));
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            const n = options.length;
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            const m = options[active];
            if (m) pick(m);
          }
        }}
      >
        <span>{monthLabel(value)}</span>
        <CaretDownIcon />
      </button>
      {open && (
        <div className="month-dropdown-list" role="listbox" aria-label="Month">
          {options.map((m, i) => (
            <div
              key={m}
              role="option"
              tabIndex={-1}
              aria-selected={m === value}
              className={`picker-option${i === active ? " is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(m)}
              onKeyDown={() => {}}
            >
              {monthLabel(m)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Fix This": un-assign exactly the over-assigned amount from a category with money available, in the viewed
 * month or a later month that has assignments. Ready to Assign (of the viewed month) then becomes 0, because it
 * counts the Assigned of every month.
 */
export function FixThisPopover({
  detail,
  budgetId,
  month,
  anchor,
  onClose,
  move,
}: {
  detail: MonthDetail;
  budgetId: string;
  month: Month;
  anchor: HTMLElement;
  onClose: () => void;
  move: (m: MoveRequest) => Promise<void>;
}) {
  const last = useMonthRange(budgetId).data?.last_assigned_month ?? null;
  const horizon = addMonths(month, MAX_AHEAD);
  const to = last === null ? null : last < horizon ? last : horizon;
  const list = useMonthList(budgetId, addMonths(month, 1), to).data;
  const options = useMemo(
    () => [month, ...(list ?? []).filter((s) => s.assigned !== 0).map((s) => s.month)],
    [month, list],
  );
  const [chosen, setChosen] = useState<Month>(month);
  const [cat, setCat] = useState<string | null>(null);
  const groups = useMonth(budgetId, chosen).data?.groups ?? detail.groups;
  const submit = () => {
    if (cat === null) return;
    void move({ month: chosen, from: cat, to: READY_TO_ASSIGN, amount: -detail.ready_to_assign });
    onClose();
  };
  return (
    <Popover
      anchor={anchor}
      width={320}
      label="Un-assign money from"
      className="move-popover"
      onClose={onClose}
    >
      <div className="move-label">Un-assign money from</div>
      <MonthDropdown
        options={options}
        value={chosen}
        onChange={(m) => {
          setChosen(m);
          setCat(null);
        }}
      />
      <CategoryPicker
        key={chosen}
        groups={groups}
        value={cat}
        onChange={setCat}
        include={positive}
        label="Category"
      />
      <div className="popover-buttons">
        <span className="popover-spacer" />
        <button type="button" className="popover-button is-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="popover-button is-primary"
          disabled={cat === null}
          onClick={submit}
        >
          OK
        </button>
      </div>
    </Popover>
  );
}
