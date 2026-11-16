import { longMonthLabel, signedChange } from "@budget/schema/reflect-format";
import type { SpendingTrends } from "@budget/schema/reports";
import type { SyntheticEvent } from "react";
import { money, percent } from "./format";
import { InfoFillIcon } from "./icons";

/** Keeps the 288px hint inside the window with a 10px margin (source). */
function shiftTip(e: SyntheticEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const left = r.left + r.width / 2 - 144;
  const clamped = Math.max(10, Math.min(left, window.innerWidth - 10 - 288));
  el.parentElement?.style.setProperty("--st-tip-shift", `${clamped - left}px`);
}

const INFO =
  "This column highlights the difference between your spending in individual months and your average monthly spending for the selected time period.";

export function TrendsTable({ data }: { data: SpendingTrends }) {
  const empty = data.months.every((m) => m.series.length === 0);
  const rows = [...data.months].reverse();
  return (
    <section className="st-card st-table-card" aria-label="Spending by month table">
      <table className="st-table">
        <thead>
          <tr>
            <th scope="col" className="st-month">
              Month
            </th>
            <th scope="col" className="st-num">
              Total Spending
            </th>
            <th scope="col" className="st-num st-compare">
              <span className="st-compare-inner">
                <span className="st-compare-label">Compared to Average</span>
                <span className="st-info">
                  <button
                    type="button"
                    className="st-info-btn"
                    onMouseEnter={shiftTip}
                    onFocus={shiftTip}
                    aria-label="About Compared to Average"
                  >
                    <InfoFillIcon width={12} height={12} />
                  </button>
                  <span className="st-info-tip" role="tooltip">
                    {INFO}
                  </span>
                </span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td colSpan={3} className="st-empty">
                No spending to show yet
              </td>
            </tr>
          ) : (
            rows.map((m) => {
              const diff = m.compared_to_average;
              const arrow = Math.abs(diff) < 5 ? "" : diff > 0 ? "↑ " : "↓ ";
              return (
                <tr key={m.month}>
                  <td className="st-month">{longMonthLabel(m.month)}</td>
                  <td className="st-num">{money(m.total)}</td>
                  <td className="st-num st-compare">
                    {arrow}
                    {signedChange(diff)} ({percent(m.compared_pct)})
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}
