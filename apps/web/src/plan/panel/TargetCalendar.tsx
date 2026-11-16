import { addMonths, monthGrid, monthTitle } from "@budget/schema/date-entry";
import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** A month of days to pick from: the title with previous and next month, Su–Sa, the days. `selected` is an ISO date or null. */
export function TargetCalendar({
  start,
  selected,
  onPick,
}: {
  /** An ISO date in the month to show first. */
  start: string;
  selected: string | null;
  onPick: (iso: string) => void;
}) {
  const [first, setFirst] = useState(`${start.slice(0, 7)}-01`);
  // Other months' days fill the first and last week, as in the source.
  const prev = monthGrid(addMonths(first, -1));
  const next = monthGrid(addMonths(first, 1));
  const weeks = monthGrid(first).map((w, wi, all) =>
    w.map((d, di) => {
      if (d) return { iso: d, other: false };
      const iso =
        wi === 0
          ? (prev[prev.length - 1]?.[di] ?? null)
          : wi === all.length - 1
            ? (next[0]?.[di] ?? null)
            : null;
      return { iso, other: true };
    }),
  );
  return (
    <div className="target-calendar">
      <div className="calendar-head">
        <button
          type="button"
          className="calendar-nav"
          aria-label="Previous month"
          onClick={() => setFirst(addMonths(first, -1))}
        >
          <ChevronLeftIcon width={16} height={16} />
        </button>
        <span className="calendar-title">{monthTitle(first)}</span>
        <button
          type="button"
          className="calendar-nav"
          aria-label="Next month"
          onClick={() => setFirst(addMonths(first, 1))}
        >
          <ChevronRightIcon width={16} height={16} />
        </button>
      </div>
      <div className="calendar-week calendar-days-head" aria-hidden="true">
        {DAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="calendar-days">
        {weeks.map((w) => (
          <div key={w.map((d) => d.iso).join()} className="calendar-week">
            {w.map((d, i) =>
              d.iso ? (
                <button
                  key={d.iso}
                  type="button"
                  className={`calendar-day${d.other ? " is-other" : ""}${d.iso === selected ? " is-selected" : ""}`}
                  aria-label={d.iso}
                  aria-pressed={d.iso === selected}
                  onClick={() => onPick(d.iso as string)}
                >
                  {Number((d.iso as string).slice(8, 10))}
                </button>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: an empty cell
                <span key={i} />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
