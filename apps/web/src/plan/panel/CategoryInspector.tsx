import type { Month } from "@budget/core/month";
import type { MonthCategoryDetail } from "@budget/schema/months";
import type { PlanView } from "@budget/schema/plan-views";
import type { ReactNode } from "react";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { AvailablePill } from "../AvailablePill";
import { categoryPill } from "../format";
import { PencilIcon } from "../icons";
import { UpcomingBox } from "../upcoming/UpcomingBox";
import { NotesCard } from "./NotesCard";
import { OverspentMessage } from "./overspentMessage";
import { PanelCard } from "./PanelCard";
import { PanelTooltip } from "./PanelTooltip";
import { type PaymentCollapsed, PaymentInspector } from "./PaymentInspector";
import { TargetCard } from "./TargetCard";

/** One selected category: its name and pencil, the Available Balance, Target and Notes cards. */
export function CategoryInspector({
  budgetId,
  month,
  category: c,
  collapsed,
  onToggle,
  targetCollapsed,
  onToggleTarget,
  onEdit,
  autoAssign,
  paymentCollapsed,
  onTogglePayment,
  onView,
}: {
  budgetId: string;
  month: Month;
  targetCollapsed: boolean;
  onToggleTarget: () => void;
  category: MonthCategoryDetail;
  collapsed: boolean;
  onToggle: () => void;
  onEdit: (anchor: HTMLElement) => void;
  /** The Auto-Assign card, drawn between the Target and Notes cards. */
  autoAssign: ReactNode;
  /** A payment category's own cards (EXF-537). */
  paymentCollapsed: PaymentCollapsed;
  onTogglePayment: (key: keyof PaymentCollapsed) => void;
  onView: (v: PlanView) => void;
}) {
  const fmt = usePlanFormatter();
  const rows: [string, string][] = [
    ["Cash Left Over From Last Month", fmt.money(c.carried)],
    ["Assigned This Month", fmt.signed(c.assigned)],
    ["Cash Spending", fmt.signed(c.cash_spending)],
    ["Credit Spending", fmt.signed(c.credit_spending)],
  ];
  const pill = categoryPill(c, fmt);
  // A credit card payment category belongs to its account: no pencil and no target until its own inspector.
  const payment = c.kind !== null;
  return (
    <>
      <div className="panel-heading">
        <h1 className="panel-title" title={c.name}>
          {c.name}
        </h1>
        {!payment && (
          <PanelTooltip text="Edit Category" align="end">
            {(trigger) => (
              <button
                type="button"
                {...trigger}
                className="panel-pencil"
                aria-label={`Edit category: ${c.name}`}
                onClick={(e) => onEdit(e.currentTarget)}
              >
                <PencilIcon />
              </button>
            )}
          </PanelTooltip>
        )}
      </div>
      {c.kind === "credit_card_payment" ? (
        <PaymentInspector
          key={c.id}
          budgetId={budgetId}
          month={month}
          c={c}
          collapsed={paymentCollapsed}
          onToggle={onTogglePayment}
          onView={onView}
          autoAssign={autoAssign}
        />
      ) : (
        <>
          <PanelCard
            id="panel-balance"
            title="Available Balance"
            collapsed={collapsed}
            onToggle={onToggle}
            right={
              <AvailablePill amount={c.available} display tone={pill?.tone} icon={pill?.icon} />
            }
          >
            {rows.map(([label, value]) => (
              <div key={label} className="panel-row">
                <span className="panel-row-label">{label}</span>
                <span className="panel-row-value" title={value}>
                  {value}
                </span>
              </div>
            ))}
            <UpcomingBox budgetId={budgetId} month={month} c={c} />
            <OverspentMessage c={c} />
          </PanelCard>
          {!payment && (
            <TargetCard
              key={c.id}
              budgetId={budgetId}
              month={month}
              category={c}
              collapsed={targetCollapsed}
              onToggle={onToggleTarget}
            />
          )}
          {autoAssign}
        </>
      )}
      <NotesCard budgetId={budgetId} categoryId={c.id} note={c.note} />
    </>
  );
}
