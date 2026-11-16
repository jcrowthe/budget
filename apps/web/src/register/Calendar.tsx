import { addMonths, monthGrid, monthTitle } from "@budget/schema/date-entry";
import { FREQUENCIES, FREQUENCY_LABELS, type Frequency } from "@budget/schema/recurrence";
import { ChevronCircleLeftIcon, ChevronCircleRightIcon } from "../plan/monthNavIcons";
import { Dropdown } from "./Dropdown";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** The date field's calendar: month arrows, a Su–Sa grid, today ringed, the field's date filled. */
export function Calendar({
  anchor,
  month,
  selected,
  today,
  onMonth,
  onPick,
  frequency,
  onFrequency,
  onRepeatBlur,
  onRepeatEscape,
}: {
  anchor: HTMLElement;
  month: string;
  selected: string | null;
  today: string;
  onMonth: (firstOfMonth: string) => void;
  onPick: (iso: string) => void;
  /** The Repeat select shows only when `onFrequency` is given (a new row, a scheduled row). */
  frequency?: Frequency;
  onFrequency?: (f: Frequency) => void;
  onRepeatBlur?: (e: React.FocusEvent<HTMLSelectElement>) => void;
  onRepeatEscape?: () => void;
}) {
  // mousedown never leaves the date field, so its focus (and this calendar) stay.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <Dropdown anchor={anchor} label="Calendar" role="dialog" width={230}>
      <div className="calendar">
        <div className="calendar-head">
          <button
            type="button"
            className="calendar-arrow"
            aria-label="Previous month"
            tabIndex={-1}
            onMouseDown={keep}
            onClick={() => onMonth(addMonths(month, -1))}
          >
            <ChevronCircleLeftIcon size={24} />
          </button>
          <span className="calendar-title" aria-live="polite">
            {monthTitle(month)}
          </span>
          <button
            type="button"
            className="calendar-arrow"
            aria-label="Next month"
            tabIndex={-1}
            onMouseDown={keep}
            onClick={() => onMonth(addMonths(month, 1))}
          >
            <ChevronCircleRightIcon size={24} />
          </button>
        </div>
        <div className="calendar-dow-row">
          {DAYS.map((d) => (
            <span key={d} className="calendar-dow">
              {d}
            </span>
          ))}
        </div>
        <div className="calendar-days">
          {monthGrid(month).map((week) => (
            <div key={week.find(Boolean) ?? month} className="calendar-row">
              {week.map((iso, i) =>
                iso ? (
                  <button
                    key={iso}
                    type="button"
                    tabIndex={-1}
                    className={`calendar-day${iso === today ? " is-today" : ""}${iso === selected ? " is-selected" : ""}`}
                    aria-label={iso}
                    aria-pressed={iso === selected}
                    onMouseDown={keep}
                    onClick={() => onPick(iso)}
                  >
                    {Number(iso.slice(8, 10))}
                  </button>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: blank cells have no identity
                  <span key={`blank-${i}`} className="calendar-blank" />
                ),
              )}
            </div>
          ))}
        </div>
        {onFrequency ? (
          <div className="calendar-repeat">
            <label htmlFor="calendar-repeat-select">Repeat:</label>
            <select
              id="calendar-repeat-select"
              aria-label="Repeat"
              value={frequency ?? "never"}
              onChange={(e) => onFrequency(e.target.value as Frequency)}
              onBlur={onRepeatBlur}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  onRepeatEscape?.();
                }
              }}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </Dropdown>
  );
}
