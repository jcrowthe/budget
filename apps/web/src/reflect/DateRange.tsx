import {
  canShift,
  type MonthSpan,
  monthIndex,
  type RangePreset,
  rangeLabel,
  shiftSpan,
} from "@budget/schema/report-range";
import { useRef, useState } from "react";
import { useDismiss } from "../plan/useDismiss";
import { CalendarIcon, CaretDownIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { MonthGrid } from "./MonthGrid";
import { useReportState } from "./state";

const PRESETS: { id: Exclude<RangePreset, "custom">; label: string }[] = [
  { id: "this_month", label: "This Month" },
  { id: "last_3_months", label: "Last 3 Months" },
  { id: "last_6_months", label: "Last 6 Months" },
  { id: "last_12_months", label: "Last 12 Months" },
  { id: "year_to_date", label: "Year To Date" },
  { id: "last_year", label: "Last Year" },
  { id: "all_dates", label: "All Dates" },
];

function CustomPanel({ onClose }: { onClose: () => void }) {
  const { span, facts, update } = useReportState();
  const [draft, setDraft] = useState<MonthSpan>(span);
  const [grid, setGrid] = useState<"start" | "end" | null>(null);
  const pick = (which: "start" | "end", m: string) => {
    setDraft((d) => {
      if (which === "start") {
        return {
          start_month: m,
          end_month: monthIndex(d.end_month) < monthIndex(m) ? m : d.end_month,
        };
      }
      return {
        start_month: monthIndex(d.start_month) > monthIndex(m) ? m : d.start_month,
        end_month: m,
      };
    });
    setGrid(null);
  };
  const field = (which: "start" | "end", label: string, value: string) => (
    <div className="custom-field">
      <span className="custom-label">{label}</span>
      <div className="custom-select-wrap">
        <button
          type="button"
          className="custom-select"
          aria-label={label}
          aria-expanded={grid === which}
          onClick={() => setGrid(grid === which ? null : which)}
        >
          <span>{rangeLabel({ start_month: value, end_month: value })}</span>
          <CaretDownIcon width={8} height={8} />
        </button>
        {grid === which && (
          <MonthGrid
            value={value}
            first={facts.first_month}
            current={facts.current_month}
            onPick={(m) => pick(which, m)}
          />
        )}
      </div>
    </div>
  );
  return (
    <div className="custom-panel">
      {field("start", "Start Date", draft.start_month)}
      {field("end", "End Date", draft.end_month)}
      <div className="custom-footer">
        <button type="button" className="reflect-btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="reflect-btn primary"
          onClick={() => {
            update({ preset: "custom", ...draft });
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export function DateRange() {
  const { span, facts, settings, update } = useReportState();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setCustom(false);
  };
  const shift = (dir: -1 | 1) => {
    const s = shiftSpan(span, dir);
    update({ preset: "custom", start_month: s.start_month, end_month: s.end_month });
  };
  return (
    <div className="date-range" ref={wrap}>
      <div className="date-pill">
        <button
          type="button"
          className="date-arrow"
          aria-label="Previous Period"
          disabled={!canShift(span, -1, facts)}
          onClick={() => shift(-1)}
        >
          <ChevronLeftIcon width={12} height={12} />
        </button>
        <span className="date-label-wrap">
          <button
            ref={trigger}
            type="button"
            className="date-label"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => (open ? close() : setOpen(true))}
          >
            <CalendarIcon width={12} height={12} />
            <span>{rangeLabel(span)}</span>
          </button>
          {open && (
            <DateMenu
              wrap={wrap}
              trigger={trigger}
              close={close}
              custom={custom}
              setCustom={setCustom}
              preset={settings.preset}
              onPreset={(p) => {
                update({ preset: p });
                close();
              }}
            />
          )}
        </span>
        <button
          type="button"
          className="date-arrow"
          aria-label="Next Period"
          disabled={!canShift(span, 1, facts)}
          onClick={() => shift(1)}
        >
          <ChevronRightIcon width={12} height={12} />
        </button>
      </div>
    </div>
  );
}

function DateMenu({
  wrap,
  trigger,
  close,
  custom,
  setCustom,
  preset,
  onPreset,
}: {
  wrap: React.RefObject<HTMLDivElement | null>;
  trigger: React.RefObject<HTMLButtonElement | null>;
  close: () => void;
  custom: boolean;
  setCustom: (v: boolean) => void;
  preset: RangePreset;
  onPreset: (p: Exclude<RangePreset, "custom">) => void;
}) {
  useDismiss(wrap, close, trigger);
  return (
    <div className="date-menu" role="menu" aria-label="Date range">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="menuitemradio"
          aria-checked={!custom && preset === p.id}
          className="date-item"
          onClick={() => onPreset(p.id)}
        >
          <span>{p.label}</span>
          {!custom && preset === p.id && <CheckIcon width={16} height={16} />}
        </button>
      ))}
      <hr className="menu-separator" />
      <button
        type="button"
        role="menuitemradio"
        aria-checked={custom || preset === "custom"}
        className="date-item"
        onClick={() => setCustom(true)}
      >
        <span>Custom</span>
        {(custom || preset === "custom") && <CheckIcon width={16} height={16} />}
      </button>
      {custom && <CustomPanel onClose={close} />}
    </div>
  );
}
