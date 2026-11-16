import type { MonthCategoryDetail } from "@budget/schema/months";
import type { PlanView } from "@budget/schema/plan-views";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { accountPath } from "../../shell/planPaths";
import { AvailablePill } from "../AvailablePill";
import { categoryPill, money, signed } from "../format";
import { CheckCircleFillIcon, WarningTriangleIcon } from "../icons";
import { PanelCard } from "./PanelCard";

export type PaymentCollapsed = { paymentBalance: boolean; forPayment: boolean };

const row = (label: string, value: string) => (
  <div key={label} className="panel-row">
    <span className="panel-row-label">{label}</span>
    <span className="panel-row-value" title={value}>
      {value}
    </span>
  </div>
);

/** The yellow bar of the two underfunded states: the share of the balance the Available covers. */
function PaymentBar({ available, balance }: { available: number; balance: number }) {
  const share = balance < 0 ? Math.min(1, Math.max(0, available / -balance)) : 0;
  return (
    <div className="payment-bar" aria-hidden="true">
      <div className="payment-bar-fill" style={{ width: `${share * 100}%` }} />
    </div>
  );
}

/** The Payment card in exactly one of five states (EXF-537). The card's name is inserted in the copy. */
function PaymentCard({
  budgetId,
  c,
  onView,
}: {
  budgetId: string;
  c: MonthCategoryDetail;
  onView: (v: PlanView) => void;
}) {
  const navigate = useNavigate();
  const p = c.payment;
  if (!p) return null;
  let body: ReactNode;
  switch (p.state) {
    case "paid_off":
      body = (
        <>
          <CheckCircleFillIcon className="payment-icon positive" width={20} height={20} />
          <h3>Your {c.name} is paid off!</h3>
          <p>Being debt free is a wonderful thing.</p>
        </>
      );
      break;
    case "overpaid":
      body = (
        <>
          <WarningTriangleIcon className="payment-icon negative" width={20} height={20} />
          <p>You sent more to {c.name} than you had set aside for the payment.</p>
        </>
      );
      break;
    case "enough":
      body = (
        <>
          <h3>You have enough money to pay off your current balance!</h3>
          <p>You can make this payment anytime.</p>
          {c.account_id && (
            <button
              type="button"
              className="popover-button is-primary payment-button"
              onClick={() => navigate(accountPath(budgetId, c.account_id as string))}
            >
              Record Payment
            </button>
          )}
        </>
      );
      break;
    case "overspent_categories":
      body = (
        <>
          <h3>
            <WarningTriangleIcon className="payment-icon cautious" width={16} height={16} />
            Overspent Categories
          </h3>
          <PaymentBar available={p.available} balance={p.current_balance} />
          <p>
            Cover {money(p.overspent_categories)} in overspent categories in order to pay off your
            current balance.
          </p>
          <button
            type="button"
            className="popover-button is-primary payment-button"
            onClick={() => onView("overspent")}
          >
            Cover Overspent Categories
          </button>
        </>
      );
      break;
    case "underfunded":
      body = (
        <>
          <h3>
            <WarningTriangleIcon className="payment-icon cautious" width={16} height={16} />
            Underfunded
          </h3>
          <PaymentBar available={p.available} balance={p.current_balance} />
          <p>You need to assign {money(p.underfunded)} more to pay off your current balance.</p>
        </>
      );
      break;
  }
  return (
    <section className="panel-card payment-card" aria-label="Payment">
      <div className="panel-card-static payment-card-body" data-state={p.state}>
        {body}
      </div>
    </section>
  );
}

/** The cards of a payment category's inspector, between its title and Notes. */
export function PaymentInspector({
  budgetId,
  c,
  collapsed,
  onToggle,
  onView,
  autoAssign,
}: {
  budgetId: string;
  c: MonthCategoryDetail;
  collapsed: PaymentCollapsed;
  onToggle: (key: keyof PaymentCollapsed) => void;
  onView: (v: PlanView) => void;
  autoAssign: ReactNode;
}) {
  const p = c.payment;
  const pill = categoryPill(c);
  return (
    <>
      <PaymentCard budgetId={budgetId} c={c} onView={onView} />
      {p && p.underfunded > 0 && (
        <section className="panel-card panel-card-static payment-total">
          <div className="panel-row">
            <h2 className="panel-card-title">Total Underfunded</h2>
            <span className="panel-row-value">{money(p.underfunded)}</span>
          </div>
        </section>
      )}
      {p && p.overspent_categories > 0 && (
        <section className="panel-card panel-card-static payment-total">
          <div className="panel-row">
            <h2 className="panel-card-title">Overspent Categories</h2>
            <span className="panel-row-value">{money(p.overspent_categories)}</span>
          </div>
        </section>
      )}
      {p && (
        <PanelCard
          id="panel-payment-balance"
          title="Current Balance"
          collapsed={collapsed.paymentBalance}
          onToggle={() => onToggle("paymentBalance")}
          right={<span className="payment-balance-total">{signed(p.current_balance)}</span>}
        >
          {row("Prior Balance", money(p.prior_balance))}
          <h3 className="this-month">Activity This Month</h3>
          {row("Spending and Outflows", money(p.spending_and_outflows))}
          {row("Interest Charges", money(p.interest_charges))}
          {row("Payments and Inflows", signed(p.payments_and_inflows))}
        </PanelCard>
      )}
      <PanelCard
        id="panel-for-payment"
        title="Available for Payment"
        collapsed={collapsed.forPayment}
        onToggle={() => onToggle("forPayment")}
        right={<AvailablePill amount={c.available} display tone={pill?.tone} icon={pill?.icon} />}
      >
        {row("Cash Left Over From Last Month", money(c.carried))}
        {row("Assigned This Month", signed(c.assigned))}
        {row("Activity", signed(c.activity))}
      </PanelCard>
      {autoAssign}
    </>
  );
}
