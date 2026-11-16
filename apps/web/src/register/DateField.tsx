import { dateKeyAction, formatEntryDate, parseEntryDate } from "@budget/schema/date-entry";
import { useState } from "react";
import { Calendar } from "./Calendar";
import { CaretDownIcon } from "./icons";

/** The date input with its calendar (open while focused) and the keys of EXF-517. */
export function DateField({
  text,
  lastDate,
  today,
  onChange,
}: {
  text: string;
  lastDate: string;
  today: string;
  onChange: (text: string, lastDate: string) => void;
}) {
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
        type="text"
        aria-label="Date"
        autoComplete="off"
        value={text}
        onFocus={(e) => {
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
        onBlur={() => {
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
        />
      ) : null}
    </div>
  );
}
