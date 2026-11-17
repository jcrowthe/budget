import { type MonthSpan, monthLabel } from "@budget/schema/report-range";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { type ReportTransactionSelector, useReportTransactions } from "../api/reports";
import { useDismiss } from "../plan/useDismiss";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { accountPath } from "../shell/planPaths";
import { drillAmount } from "./format";
import { useReportState } from "./state";

const MARGIN = 8;
const ARROW = 15;
/** Header, column header and footer around the scrolling body. */
const CHROME = 120;

/** The transactions behind a report figure, anchored at the click that opened it. */
export function TransactionPopover({
  title,
  selector,
  x,
  y,
  span: ownSpan,
  excludedCategoryIds,
  onClose,
}: {
  title: string;
  selector: ReportTransactionSelector;
  /** The months to list; the report's own range when absent. */
  span?: MonthSpan;
  /** Applies to the spending selectors only. */
  excludedCategoryIds?: string[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const fmt = usePlanFormatter();
  const { budgetId, span: reportSpan, settings } = useReportState();
  const span = ownSpan ?? reportSpan;
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useDismiss(ref, onClose);
  useLayoutEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const { data, isPending, isError } = useReportTransactions(
    budgetId,
    span,
    selector,
    settings.excluded_account_ids,
    excludedCategoryIds,
  );

  const width = Math.min(720, vp.w - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(x - width / 2, vp.w - width - MARGIN));
  const below = vp.h - (y + ARROW) - MARGIN >= 240;
  const room = below ? vp.h - (y + ARROW) - MARGIN : y - ARROW - MARGIN;
  const bodyMax = Math.max(80, Math.min(400, room - CHROME));
  const arrow = Math.max(12, Math.min(x - left - ARROW, width - 42));
  const place = below ? { top: y + ARROW } : { bottom: vp.h - (y - ARROW) };

  return createPortal(
    <div
      ref={ref}
      className={`sb-popover ${below ? "below" : "above"}`}
      role="dialog"
      aria-label={title}
      style={{ left, width, ...place }}
    >
      <span className="sb-popover-arrow" aria-hidden="true" style={{ left: arrow }} />
      <h2 className="sb-popover-title">{title}</h2>
      <div className="sb-popover-body" style={{ maxHeight: bodyMax }}>
        <table className="sb-table">
          <thead>
            <tr>
              <th scope="col">ACCOUNT</th>
              <th scope="col">DATE</th>
              <th scope="col">PAYEE</th>
              <th scope="col">MEMO</th>
              <th scope="col" className="num">
                AMOUNT
              </th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((t) => {
              const go = () => navigate(accountPath(budgetId, t.account_id));
              return (
                <tr
                  key={t.subtransaction_id ?? t.transaction_id}
                  tabIndex={0}
                  onClick={go}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") go();
                  }}
                >
                  <td>{t.account_name}</td>
                  <td>{fmt.date(t.date)}</td>
                  <td>{t.payee_name}</td>
                  <td>{t.memo}</td>
                  <td className={`num ${t.amount > 0 ? "inflow" : ""}`}>
                    {drillAmount(t.amount, fmt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isPending && <p className="sb-popover-note">Loading…</p>}
        {isError && <p className="sb-popover-note">The transactions could not be loaded.</p>}
        {data && data.length === 0 && <p className="sb-popover-note">No transactions</p>}
      </div>
      <div className="sb-popover-footer">
        <span className="sb-popover-range">
          {monthLabel(span.start_month)}
          {span.start_month === span.end_month ? "" : ` – ${monthLabel(span.end_month)}`}
        </span>
        <button type="button" className="reflect-btn secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}
