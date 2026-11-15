import { addMonths, type Month } from "@budget/core/month";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { useMonth, useMonthRange, useSetMonthNote } from "../api/months";
import { localCurrentMonth, usePlanMonth } from "../shell/planPaths";
import { MonthNotePopover } from "./MonthNotePopover";
import { MonthPicker } from "./MonthPicker";
import { canNext, canPrev, monthLabel, NEXT_DISABLED_TITLE, navLimits } from "./monthNav";
import { CaretDownIcon, ChevronCircleLeftIcon, ChevronCircleRightIcon } from "./monthNavIcons";
import "./plan-header.css";

type Open = { kind: "picker" | "note"; style: CSSProperties } | null;

const POPOVER_WIDTH = 224;
const POPOVER_GAP = 15;

/** Centred under the trigger, 15px below it, inside the (positioned) calendar block. */
function under(el: HTMLElement | null): CSSProperties {
  if (!el) return {};
  return {
    left: el.offsetLeft + el.offsetWidth / 2 - POPOVER_WIDTH / 2,
    top: el.offsetTop + el.offsetHeight + POPOVER_GAP,
  };
}

/**
 * The Plan header. Left: arrows, month with its picker, Today and the month note.
 * `children` render in the centre block: EXF-491 passes the Ready to Assign pill there.
 */
export function PlanHeader({
  budgetId,
  month,
  children,
}: {
  budgetId: string;
  month: Month;
  children?: ReactNode;
}) {
  const current = localCurrentMonth();
  const limits = navLimits(useMonthRange(budgetId).data, current);
  const note = useMonth(budgetId, month).data?.note ?? null;
  const { setMonth } = usePlanMonth();
  const saveNote = useSetMonthNote(budgetId);
  const [open, setOpen] = useState<Open>(null);
  const monthRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a popover closes when the month changes
  useEffect(() => setOpen(null), [month]);
  const next = canNext(month, limits);
  const toggle = (kind: "picker" | "note", el: HTMLElement | null) =>
    setOpen((o) => (o?.kind === kind ? null : { kind, style: under(el) }));

  return (
    <header className="page-header plan plan-header">
      <div className="plan-header-calendar">
        <button
          type="button"
          className="month-arrow prev"
          aria-label="Previous month"
          disabled={!canPrev(month, limits)}
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <ChevronCircleLeftIcon />
        </button>
        <div className="plan-header-date">
          <h1>
            <button
              ref={monthRef}
              type="button"
              className="month-button"
              aria-haspopup="dialog"
              aria-expanded={open?.kind === "picker"}
              onClick={() => toggle("picker", monthRef.current)}
            >
              {monthLabel(month)}
              <CaretDownIcon />
            </button>
          </h1>
          <button
            ref={noteRef}
            type="button"
            className="month-note"
            title={note ?? ""}
            aria-haspopup="dialog"
            aria-expanded={open?.kind === "note"}
            onClick={() => toggle("note", noteRef.current)}
          >
            {note ?? "Enter a note..."}
          </button>
        </div>
        <button
          type="button"
          className="month-arrow next"
          aria-label="Next month"
          title={next ? undefined : NEXT_DISABLED_TITLE}
          disabled={!next}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronCircleRightIcon />
        </button>
        {month !== current && (
          <button type="button" className="today-button" onClick={() => setMonth(current)}>
            Today
          </button>
        )}
        {open?.kind === "picker" && (
          <MonthPicker
            key={month}
            month={month}
            current={current}
            limits={limits}
            onPick={setMonth}
            onClose={() => setOpen(null)}
            triggerRef={monthRef}
            style={open.style}
          />
        )}
        {open?.kind === "note" && (
          <MonthNotePopover
            key={month}
            note={note}
            onSave={(n) => saveNote.mutate({ month, note: n })}
            onClose={() => setOpen(null)}
            triggerRef={noteRef}
            style={open.style}
          />
        )}
      </div>
      {/* EXF-491: the Ready to Assign pill is passed as children */}
      <div className="plan-header-totals">{children}</div>
    </header>
  );
}
