import type { Month } from "@budget/core/month";
import { useEffect, useState } from "react";
import { useCategoryUpcoming } from "../../api/upcoming";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { activityListMax } from "../activity-popover";
import { amountClass } from "../format";
import { Popover } from "../Popover";
import "../activity-popover.css";

/** The scheduled transactions behind a category's Upcoming for a month, latest first (EXF-505). */
export function UpcomingPopover({
  budgetId,
  month,
  category,
  anchor,
  onClose,
}: {
  budgetId: string;
  month: Month;
  category: { id: string; name: string };
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const fmt = usePlanFormatter();
  const q = useCategoryUpcoming(budgetId, month, category.id);
  const [listMax, setListMax] = useState(() =>
    activityListMax(anchor.getBoundingClientRect(), window.innerHeight),
  );
  useEffect(() => {
    const measure = () =>
      setListMax(activityListMax(anchor.getBoundingClientRect(), window.innerHeight));
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor]);
  const rows = q.data?.occurrences;
  return (
    <Popover
      key={q.status}
      anchor={anchor}
      width={512}
      label="Activity"
      className="activity-popover"
      dismissOnOutside
      onClose={onClose}
    >
      <h2 className="activity-title">Activity</h2>
      <p className="activity-subtitle" title={category.name}>
        {category.name}
      </p>
      <div className="activity-list" style={{ maxHeight: listMax }}>
        {rows && rows.length > 0 && (
          <table className="activity-table">
            <colgroup>
              <col className="col-account" />
              <col className="col-date" />
              <col className="col-payee" />
              <col className="col-memo" />
              <col className="col-amount" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Date</th>
                <th scope="col">Payee</th>
                <th scope="col">Memo</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={`${o.scheduled_transaction_id}:${o.date}`}>
                  <td title={o.account_name}>{o.account_name}</td>
                  <td>{fmt.date(o.date)}</td>
                  <td title={o.payee_name ?? undefined}>{o.payee_name}</td>
                  <td title={o.memo ?? undefined}>{o.memo}</td>
                  <td
                    className={`num ${amountClass(o.amount)}${o.amount < 0 ? " negative" : ""}`}
                    title={fmt.money(o.amount)}
                  >
                    {fmt.money(o.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {q.isPending && <p className="activity-note">Loading…</p>}
      {q.isError && (
        <p className="activity-note">The scheduled transactions could not be loaded.</p>
      )}
      {rows && rows.length === 0 && <p className="activity-note">No scheduled transactions</p>}
      <div className="popover-buttons">
        <span className="popover-spacer" />
        <button
          type="button"
          className="popover-button is-primary"
          onClick={() => {
            onClose();
            anchor.focus();
          }}
        >
          Close
        </button>
      </div>
    </Popover>
  );
}
