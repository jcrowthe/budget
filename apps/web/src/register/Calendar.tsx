import { addMonths, monthGrid, monthTitle } from "@budget/schema/date-entry";
import { Dropdown } from "./Dropdown";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** The date field's calendar: month arrows, a Su–Sa grid, today ringed, the field's date filled. */
export function Calendar({
  anchor,
  month,
  selected,
  today,
  onMonth,
  onPick,
}: {
  anchor: HTMLElement;
  month: string;
  selected: string | null;
  today: string;
  onMonth: (firstOfMonth: string) => void;
  onPick: (iso: string) => void;
}) {
  // mousedown never leaves the date field, so its focus (and this calendar) stay.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <Dropdown anchor={anchor} label="Calendar" role="dialog" minWidth={232}>
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
            <ChevronLeftIcon />
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
            <ChevronRightIcon />
          </button>
        </div>
        <div className="calendar-grid">
          <div className="calendar-row">
            {DAYS.map((d) => (
              <span key={d} className="calendar-dow">
                {d}
              </span>
            ))}
          </div>
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
      </div>
    </Dropdown>
  );
}
