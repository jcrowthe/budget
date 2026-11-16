import { MONTH_NAMES, type Month, monthIndex } from "@budget/schema/report-range";
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

/** A year with ‹ ›, and Jan…Dec; months outside [first, current] are disabled. */
export function MonthGrid({
  value,
  first,
  current,
  onPick,
}: {
  value: Month;
  first: Month;
  current: Month;
  onPick: (m: Month) => void;
}) {
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const ref = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);
  // Opens below its select (source); flips above when the window has no room below.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.bottom > window.innerHeight - 8) setUp(true);
  }, []);
  return (
    <div ref={ref} className={`month-grid${up ? " up" : ""}`}>
      <div className="month-grid-years">
        <button type="button" aria-label="Previous Year" onClick={() => setYear(year - 1)}>
          <span className="year-circle">
            <ChevronLeftIcon width={14} height={14} />
          </span>
        </button>
        <strong>{year}</strong>
        <button type="button" aria-label="Next Year" onClick={() => setYear(year + 1)}>
          <span className="year-circle">
            <ChevronRightIcon width={14} height={14} />
          </span>
        </button>
      </div>
      <div className="month-grid-months">
        {MONTH_NAMES.map((name, i) => {
          const m = `${String(year).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}-01`;
          const disabled = monthIndex(m) < monthIndex(first) || monthIndex(m) > monthIndex(current);
          return (
            <button
              key={m}
              type="button"
              className={m === current ? "current" : undefined}
              aria-label={`${name} ${year}`}
              aria-pressed={m === value}
              disabled={disabled}
              onClick={() => onPick(m)}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
