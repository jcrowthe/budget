import { formatEntryDate, parseEntryDate } from "@budget/schema/date-entry";
import { useRef, useState } from "react";
import { CalendarIcon } from "../icons";
import { Popover } from "../Popover";
import { TargetCalendar } from "./TargetCalendar";

/** An `MM/DD/YYYY` field with a calendar that opens above it on a click. */
export function TargetDateField({
  label,
  value,
  onChange,
  today,
  disabled,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  today: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const parsed = parseEntryDate(value, today);
  return (
    <div ref={box} className="target-field target-date">
      <input
        ref={input}
        type="text"
        className="target-input"
        placeholder="MM/DD/YYYY"
        aria-label={label}
        aria-haspopup="dialog"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => setOpen(true)}
      />
      <span className="target-field-icon" aria-hidden="true">
        <CalendarIcon width={12} height={12} />
      </span>
      {open && box.current && (
        <Popover
          anchor={box.current}
          width={256}
          label="Calendar"
          placement="above"
          dismissOnOutside
          className="target-popup calendar-popup"
          onClose={() => setOpen(false)}
        >
          <TargetCalendar
            start={parsed ?? today}
            selected={parsed}
            onPick={(iso) => {
              onChange(formatEntryDate(iso));
              setOpen(false);
              input.current?.focus();
            }}
          />
        </Popover>
      )}
    </div>
  );
}
