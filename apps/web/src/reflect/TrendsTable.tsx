import { longMonthLabel, signedChange } from "@budget/schema/reflect-format";
import type { SpendingTrends } from "@budget/schema/reports";
import { money, percent } from "./format";
import { InfoIcon } from "./icons";

const INFO =
  "This column highlights the difference between your spending in individual months and your average monthly spending for the selected time period.";

export function TrendsTable({ data }: { data: SpendingTrends }) {
  const empty = data.series.length === 0;
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
              <span className="st-compare-label">Compared to Average</span>
              <span className="st-info">
                <button
                  type="button"
                  className="st-info-btn"
                  aria-label="About Compared to Average"
                >
                  <InfoIcon width={12} height={16} />
                </button>
                <span className="st-info-tip" role="tooltip">
                  {INFO}
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
