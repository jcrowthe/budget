import type { Month } from "@budget/core/month";
import { type RefObject, useRef, useState } from "react";
import { inLimits, MONTH_SHORT, monthLabel, type NavLimits } from "./monthNav";
import { ChevronCircleLeftIcon, ChevronCircleRightIcon } from "./monthNavIcons";
import { useDismiss } from "./useDismiss";

export function MonthPicker({
  month,
  current,
  limits,
  onPick,
  onClose,
  triggerRef,
  style,
}: {
  month: Month;
  current: Month;
  limits: NavLimits | null;
  onPick: (m: Month) => void;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  useDismiss(ref, onClose, triggerRef, { consumeOutsidePress: true });
  return (
    <div ref={ref} className="month-picker" role="dialog" aria-label="Choose month" style={style}>
      <span className="popover-arrow" aria-hidden="true" />
      <div className="month-picker-years">
        <button
          type="button"
          className="month-picker-year-nav"
          aria-label="Previous Year"
          title="Previous Year"
          onClick={() => setYear(year - 1)}
        >
          <ChevronCircleLeftIcon size={24} />
        </button>
        <span className="month-picker-year">{year}</span>
        <button
          type="button"
          className="month-picker-year-nav"
          aria-label="Next Year"
          title="Next Year"
          onClick={() => setYear(year + 1)}
        >
          <ChevronCircleRightIcon size={24} />
        </button>
      </div>
      <div className="month-picker-months">
        {MONTH_SHORT.map((name, i) => {
          const m = `${String(year).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}-01`;
          const cls = ["picker-month", m === month && "is-selected", m === current && "is-current"]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={m}
              type="button"
              className={cls}
              aria-label={monthLabel(m)}
              aria-current={m === current ? "date" : undefined}
              disabled={!inLimits(m, limits)}
              onClick={() => {
                onPick(m);
                onClose();
              }}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
