import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePayeeRecentTransactions } from "../api/payees";
import { CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";

const WIDTH = 420;
const GAP = 12;
const EDGE = 16;

/**
 * The `Last 3 transactions` popover of one payee: the three rows its category default is read from.
 * Laid inside the Manage Payees dialog, under the link that opened it (above it when there is no room below).
 * Escape closes only this popover: its controls carry `data-dirty`, which the dialog's Escape leaves alone.
 */
export function RecentPopover({
  budgetId,
  payeeId,
  anchor,
  onClose,
}: {
  budgetId: string;
  payeeId: string;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const fmt = usePlanFormatter();
  const q = usePayeeRecentTransactions(budgetId, payeeId);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [above, setAbove] = useState(false);
  const container = anchor.closest<HTMLElement>(".manage-payees-dialog");
  const rows = q.data ?? [];

  // Focus the Close button on open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useLayoutEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);

  // Below the link when the measured height fits above the dialog's bottom edge, else above it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again whenever the rows arrive
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !container) return;
    const c = container.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    setAbove(a.bottom + GAP + el.offsetHeight > c.bottom - EDGE);
  }, [rows.length, q.isSuccess]);

  if (!container) return null;
  const c = container.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const width = Math.min(WIDTH, c.width - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(a.left - c.left, c.width - EDGE - width));
  const arrow = Math.max(12, Math.min(width - 28, a.left - c.left + a.width / 2 - left - 8));
  const place = above
    ? { left, width, bottom: c.bottom - a.top + GAP }
    : { left, width, top: a.bottom - c.top + GAP };
  const category = (t: (typeof rows)[number]) =>
    t.inflow_to_ready_to_assign ? "Ready to Assign" : (t.category_name ?? "");

  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Escape closes the popover from anywhere inside it
    <div
      ref={box}
      className={`mp-popover mp-recent${above ? " is-above" : ""}`}
      role="dialog"
      aria-label="Last 3 transactions"
      tabIndex={-1}
      data-dirty=""
      style={place}
      onKeyDown={key}
    >
      <span className="mp-popover-arrow" style={{ left: arrow }} aria-hidden="true" />
      <div className="mp-popover-content">
        <div className="mp-popover-head">
          <h3>Last 3 transactions</h3>
          <button
            type="button"
            className="mp-x"
            aria-label="Close last 3 transactions"
            data-dirty=""
            onClick={onClose}
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        {q.isSuccess && rows.length === 0 ? (
          <p className="mp-popover-note">No transactions yet.</p>
        ) : (
          <table className="mp-table mp-recent-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>CATEGORY</th>
                <th className="is-amount">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; they are replaced as a whole
                <tr key={`${t.date}-${i}`}>
                  <td>{fmt.date(t.date)}</td>
                  <td title={category(t)}>{category(t)}</td>
                  <td className="is-amount">{fmt.money(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mp-buttons">
        <button
          ref={close}
          type="button"
          className="mp-button mp-primary"
          data-dirty=""
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>,
    container,
  );
}
