import type { Month } from "@budget/core/month";
import { activityMoreText } from "@budget/schema/category-activity";
import { formatEntryDate } from "@budget/schema/date-entry";
import { useEffect, useState } from "react";
import { useCategoryActivity } from "../api/category-activity";
import { amountClass, money } from "./format";
import { Popover } from "./Popover";
import "./activity-popover.css";

/** Title, subtitle, table head, footer and padding around the scrolling list. */
export const ACTIVITY_CHROME = 150;
const ARROW_GAP = 15;
const MARGIN = 8;

/** The list's max-height: the roomier side of the anchor, less the chrome, between 72 and 320 px. */
export function activityListMax(anchor: DOMRect, innerHeight: number): number {
  const above = anchor.top - ARROW_GAP - MARGIN;
  const below = innerHeight - anchor.bottom - ARROW_GAP - MARGIN;
  return Math.min(320, Math.max(72, Math.max(above, below) - ACTIVITY_CHROME));
}

export function ActivityPopover({
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
  const q = useCategoryActivity(budgetId, month, category.id);
  const [listMax, setListMax] = useState(() =>
    activityListMax(anchor.getBoundingClientRect(), window.innerHeight),
  );
  useEffect(() => {
    const measure = () =>
      setListMax(activityListMax(anchor.getBoundingClientRect(), window.innerHeight));
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor]);
  const data = q.data;
  const more = data ? activityMoreText(data) : null;
  return (
    // The key re-places the box once the rows are in, so it is measured at its real height.
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
        {data && data.transactions.length > 0 && (
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
              {data.transactions.map((t) => (
                <tr key={t.subtransaction_id ?? t.id}>
                  <td title={t.account_name}>{t.account_name}</td>
                  <td>{formatEntryDate(t.date)}</td>
                  <td title={t.payee_name ?? undefined}>{t.payee_name}</td>
                  <td title={t.memo ?? undefined}>{t.memo}</td>
                  <td className={`num ${amountClass(t.amount)}${t.amount < 0 ? " negative" : ""}`}>
                    {money(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {q.isPending && <p className="activity-note">Loading…</p>}
      {q.isError && <p className="activity-note">The transactions could not be loaded.</p>}
      {data && data.transactions.length === 0 && <p className="activity-note">No transactions</p>}
      {more && <p className="activity-more">{more}</p>}
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
