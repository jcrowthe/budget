import type { Month } from "@budget/core/month";
import type { MonthDetail } from "@budget/schema/months";
import { READY_TO_ASSIGN } from "@budget/schema/moves";
import type { PlanView } from "@budget/schema/plan-views";
import { useState } from "react";
import type { MoveRequest } from "../api/moves";
import { AutoAssignOptions } from "./AutoAssignOptions";
import { CategoryPicker } from "./CategoryPicker";
import { MoveAmountField } from "./MoveAmountField";
import { Popover } from "./Popover";

/** "Assign": move Ready to Assign into a category (Manually), or apply an Auto-Assign option plan-wide (Auto). */
export function AssignPopover({
  budgetId,
  detail,
  month,
  view,
  onViewAll,
  anchor,
  onClose,
  move,
}: {
  budgetId: string;
  detail: MonthDetail;
  /** The Plan view in use: the Auto tab works on the categories it shows. */
  view: PlanView;
  onViewAll: () => void;
  month: Month;
  anchor: HTMLElement;
  onClose: () => void;
  move: (m: MoveRequest) => Promise<void>;
}) {
  const [tab, setTab] = useState<"auto" | "manual">("manual");
  const [amount, setAmount] = useState(detail.ready_to_assign);
  const [to, setTo] = useState<string | null>(null);
  const ok = to !== null && amount > 0;
  const submit = () => {
    if (!ok || to === null) return;
    void move({ month, from: READY_TO_ASSIGN, to, amount });
    onClose();
  };
  return (
    <Popover anchor={anchor} width={320} label="Assign" className="move-popover" onClose={onClose}>
      <div className="assign-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`assign-tab${tab === "auto" ? " is-selected" : ""}`}
          aria-selected={tab === "auto"}
          onClick={() => setTab("auto")}
        >
          Auto
        </button>
        <button
          type="button"
          role="tab"
          className={`assign-tab${tab === "manual" ? " is-selected" : ""}`}
          aria-selected={tab === "manual"}
          onClick={() => setTab("manual")}
        >
          Manually
        </button>
      </div>
      {tab === "auto" ? (
        <div role="tabpanel" className="assign-panel">
          <AutoAssignOptions
            budgetId={budgetId}
            month={month}
            scope={{ view }}
            onViewAll={() => {
              onViewAll();
              onClose();
            }}
            onApplied={onClose}
          />
        </div>
      ) : (
        <div role="tabpanel" className="assign-panel">
          <div className="move-label">Assign:</div>
          <MoveAmountField base={detail.ready_to_assign} onAmount={setAmount} onEnter={submit} />
          <div className="move-label">To:</div>
          <CategoryPicker groups={detail.groups} value={to} onChange={setTo} label="To" />
          <div className="popover-buttons">
            <span className="popover-spacer" />
            <button type="button" className="popover-button is-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="popover-button is-primary"
              disabled={!ok}
              onClick={submit}
            >
              Assign
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
