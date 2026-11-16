import { monthLabel } from "@budget/schema/report-range";
import { useState } from "react";
import { useNetWorth } from "../api/reports";
import { changeClass, debtsMoney, money, percent, signedChange } from "./format";
import { InfoIcon } from "./icons";
import { NetWorthChart } from "./NetWorthChart";
import { useReportState } from "./state";

const TIP = "This column highlights how much your net worth has changed month over month.";

export function NetWorthReport() {
  const { budgetId, span, settings, today } = useReportState();
  const { data } = useNetWorth(budgetId, span, settings.excluded_account_ids, today);
  const [tip, setTip] = useState(false);
  if (!data) return null;
  const cls = changeClass(data.change);
  const arrow = data.change > 0 ? "↑ " : data.change < 0 ? "↓ " : "";
  return (
    <>
      <section className="nw-card" aria-label="Net Worth summary">
        <div className="nw-summary">
          <div>
            <div className="nw-caption">Net Worth</div>
            <div className="nw-big" data-testid="nw-total">
              {money(data.net_worth)}
            </div>
          </div>
          <div className="nw-stat">
            <div className="nw-caption">
              <span className="legend-square assets" />
              Assets
            </div>
            <div className="nw-amount" data-testid="nw-assets">
              {money(data.assets)}
            </div>
          </div>
          <div className="nw-stat">
            <div className="nw-caption">
              <span className="legend-square debts" />
              Debts
            </div>
            <div className="nw-amount" data-testid="nw-debts">
              {debtsMoney(data.debts)}
            </div>
          </div>
          <div className="nw-stat">
            <div className="nw-caption">Change in Net Worth</div>
            <div className={`nw-amount ${cls}`} data-testid="nw-change">
              {signedChange(data.change)}
            </div>
            {data.change_pct !== null && (
              <div className={`nw-pct ${cls}`} data-testid="nw-change-pct">
                {arrow}
                {percent(Math.abs(data.change_pct))}
              </div>
            )}
          </div>
        </div>
        <NetWorthChart data={data} />
      </section>
      <section className="nw-card nw-table-card" aria-label="Net Worth by month">
        <table className="nw-table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="num">
                Net Worth
              </th>
              <th scope="col" className="num">
                Monthly Change
                <span className="info-wrap">
                  <button
                    type="button"
                    className="info-button"
                    aria-label="About Monthly Change"
                    aria-describedby={tip ? "nw-change-tip" : undefined}
                    onMouseEnter={() => setTip(true)}
                    onMouseLeave={() => setTip(false)}
                    onFocus={() => setTip(true)}
                    onBlur={() => setTip(false)}
                  >
                    <InfoIcon width={14} height={14} />
                  </button>
                  {tip && (
                    <span id="nw-change-tip" role="tooltip" className="info-tooltip">
                      {TIP}
                    </span>
                  )}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.has_data ? (
              [...data.months].reverse().map((m) => {
                const c = changeClass(m.change);
                return (
                  <tr key={m.month} data-month={m.month}>
                    <td>{monthLabel(m.month)}</td>
                    <td className="num">{money(m.net_worth)}</td>
                    <td className={`num change ${c}`}>
                      {m.change > 0 ? "↑ " : m.change < 0 ? "↓ " : ""}
                      {signedChange(m.change)}
                      {m.change_pct !== null && ` (${percent(m.change_pct)})`}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={3} className="nw-empty">
                  No information to show
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
