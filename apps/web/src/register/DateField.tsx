import { dateKeyAction, formatEntryDate, parseEntryDate } from "@budget/schema/date-entry";
import type { Frequency } from "@budget/schema/recurrence";
import { useRef, useState } from "react";
import { Calendar } from "./Calendar";
import { CaretDownIcon } from "./icons";

/** The date input with its calendar (open while focused) and the keys of EXF-517. */
export function DateField({
  text,
  lastDate,
  today,
  onChange,
  frequency,
  onFrequency,
}: {
  text: string;
  lastDate: string;
  today: string;
  onChange: (text: string, lastDate: string) => void;
  /** With `onFrequency` the calendar carries the Repeat select. */
  frequency?: Frequency;
  onFrequency?: (f: Frequency) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Escape in the Repeat select closes the calendar only; refocusing the input must not reopen it.
  const quiet = useRef(false);
  const inCalendar = (t: EventTarget | null) =>
    t instanceof HTMLElement && t.closest('.entry-dropdown[role="dialog"]') !== null;
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const parsed = parseEntryDate(text, today);
  const [viewMonth, setViewMonth] = useState<string | null>(null);
  const month = viewMonth ?? `${(parsed ?? lastDate).slice(0, 7)}-01`;

  const set = (iso: string, input?: HTMLInputElement) => {
    onChange(formatEntryDate(iso), iso);
    setViewMonth(null);
    if (input) requestAnimationFrame(() => input.select());
  };

  return (
    <div className="entry-input entry-picker" ref={setAnchor}>
      <input
        ref={input}
        type="text"
        aria-label="Date"
        autoComplete="off"
        value={text}
        onFocus={(e) => {
          if (quiet.current) {
            quiet.current = false;
            return;
          }
          setOpen(true);
          e.currentTarget.select();
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          const t = e.target.value;
          const p = parseEntryDate(t, today);
          onChange(t, p ?? lastDate);
          setViewMonth(null);
        }}
        onKeyDown={(e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          const result = dateKeyAction(e.key, parsed ?? lastDate, today);
          if (result) {
            e.preventDefault();
            set(result, e.currentTarget);
          }
        }}
        onBlur={(e) => {
          // Moving to the Repeat select keeps the calendar open.
          if (inCalendar(e.relatedTarget)) return;
          setOpen(false);
          setViewMonth(null);
          if (parsed) onChange(formatEntryDate(parsed), parsed);
        }}
      />
      <CaretDownIcon className="entry-caret" />
      {open && anchor ? (
        <Calendar
          anchor={anchor}
          month={month}
          selected={parsed}
          today={today}
          onMonth={setViewMonth}
          onPick={(iso) => set(iso)}
          frequency={frequency}
          onFrequency={
            onFrequency
              ? (f) => {
                  onFrequency(f);
                  input.current?.focus();
                }
              : undefined
          }
          onRepeatBlur={(e) => {
            if (e.relatedTarget === input.current || inCalendar(e.relatedTarget)) return;
            setOpen(false);
            setViewMonth(null);
            if (parsed) onChange(formatEntryDate(parsed), parsed);
          }}
          onRepeatEscape={() => {
            quiet.current = true;
            setOpen(false);
            input.current?.focus();
            // Focus was already there when the select never took it: nothing to swallow.
            requestAnimationFrame(() => {
              quiet.current = false;
            });
          }}
        />
      ) : null}
    </div>
  );
}
