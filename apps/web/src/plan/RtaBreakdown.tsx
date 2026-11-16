import { addMonths, type Month } from "@budget/core/month";
import type { MonthDetail } from "@budget/schema/months";
import { money } from "./format";
import { AddCircleFillIcon, InfoCircleFillIcon, SubtractCircleFillIcon } from "./icons";
import { Popover } from "./Popover";

const longMonth = (m: Month) =>
  new Date(`${m}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

/** "+$1.00", "−$1.00" (money already carries U+2212), "+$0.00" at zero. */
const signed = (m: number) => (m >= 0 ? `+${money(m)}` : money(m));

function Line({ text, amount }: { text: string; amount: number }) {
  return (
    <div className="rta-line">
      <span>{text}</span>
      <span>{signed(amount)}</span>
    </div>
  );
}

/** The Ready to Assign breakdown: what makes up the box's amount. The total always equals the box. */
export function RtaBreakdown({
  detail,
  anchor,
  alignTo,
  onClose,
}: {
  detail: MonthDetail;
  anchor: HTMLElement;
  alignTo?: HTMLElement;
  onClose: () => void;
}) {
  const b = detail.rta_breakdown;
  const here = longMonth(detail.month);
  const prev = longMonth(addMonths(detail.month, -1));
  const plus = b.left_over_from_previous + b.inflows;
  const minus = b.cash_overspending_previous + b.assigned_in_month + b.assigned_in_future;
  const total = detail.ready_to_assign;
  const state = total > 0 ? "positive" : total < 0 ? "negative" : "zero";
  return (
    <Popover
      anchor={anchor}
      width={540}
      gap={8}
      dismissOnOutside
      scrim
      alignTo={alignTo}
      label="Ready to Assign Breakdown"
      className="rta-breakdown"
      onClose={onClose}
    >
      <h2 className="rta-breakdown-title">Ready to Assign Breakdown</h2>
      <div className="rta-card">
        <div className="rta-block">
          <div className="rta-block-header is-plus">
            <AddCircleFillIcon width={16} height={16} />
            <span>{signed(plus)}</span>
          </div>
          {plus !== 0 && (
            <>
              <Line
                text={`Ready to Assign left over from ${prev}`}
                amount={b.left_over_from_previous}
              />
              <Line text={`Inflow: Ready to Assign transactions in ${here}`} amount={b.inflows} />
            </>
          )}
        </div>
        <hr className="rta-rule" />
        <div className="rta-block">
          <div className="rta-block-header is-minus">
            <SubtractCircleFillIcon width={16} height={16} />
            <span>{signed(minus)}</span>
          </div>
          {minus !== 0 && (
            <>
              <Line text={`Cash overspending in ${prev}`} amount={b.cash_overspending_previous} />
              <Line text={`Assigned in ${here}`} amount={b.assigned_in_month} />
              {b.assigned_in_future !== 0 && (
                <Line text="Assigned in Future" amount={b.assigned_in_future} />
              )}
            </>
          )}
        </div>
        <hr className="rta-rule" />
        <div className={`rta-total is-${state}`}>
          <span>Total Ready to Assign</span>
          <span>{total === 0 ? `= ${money(0)}` : `= ${signed(total)}`}</span>
        </div>
        {total > 0 && (
          <p className="rta-message">
            Give these dollars a job by assigning them to one or more categories!
          </p>
        )}
        {total === 0 && <p className="rta-message">Nice work! Every dollar has a job.</p>}
      </div>
      <div className="rta-help">
        <InfoCircleFillIcon width={24} height={24} />
        <span>Ready to Assign is money that hasn't yet been assigned to a category.</span>
      </div>
    </Popover>
  );
}
