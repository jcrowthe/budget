import type { Month } from "@budget/core/month";
import type { MonthCategoryDetail } from "@budget/schema/months";
import {
  SNOOZE_LABEL,
  SNOOZE_ONLY_CURRENT,
  SNOOZE_TIP_BODY,
  SNOOZE_TIP_TITLE,
} from "@budget/schema/target-wording";
import { type ReactNode, useEffect, useState } from "react";
import { useCommitAssigned } from "../../api/assigned";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { localCurrentMonth } from "../../shell/planPaths";
import { QuestionCircleIcon } from "../icons";
import { useToggleSnooze } from "../snooze";
import { PanelTooltip } from "./PanelTooltip";
import { Switch } from "./Switch";
import { Donut } from "./TargetCard";

/**
 * The saved view of a target, shared by the ordinary Target card and the Debt Payment Target card: the heading
 * block and donut, the message with its Assign button, the breakdown, Edit Target and the snooze switch.
 * The caller supplies the wording (`head`, `message`, `breakdown`); the Assign and snooze behaviour is here.
 */
export function TargetSavedView({
  budgetId,
  month,
  c,
  head,
  message,
  donut,
  breakdown,
  onEdit,
}: {
  budgetId: string;
  month: Month;
  c: MonthCategoryDetail;
  head: ReactNode;
  message: { tone: "cautious" | "positive"; text: string; assign: number | null } | null;
  donut: number | null;
  breakdown: { label: string; amount: number; rule?: boolean }[];
  onEdit: () => void;
}) {
  const fmt = usePlanFormatter();
  const [assignError, setAssignError] = useState(false);
  // The to-go the Assign button has added; the button stays disabled until the month read shows another figure.
  const [assigning, setAssigning] = useState<number | null>(null);
  const assign = useCommitAssigned(budgetId, month, () => {
    setAssigning(null);
    setAssignError(true);
  });
  // A new to-go figure means the month was read again after the Assign.
  const toGo = message?.assign ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: clears when the figure changes
  useEffect(() => {
    setAssigning((a) => (a !== null && a !== toGo ? null : a));
  }, [toGo]);
  const snooze = useToggleSnooze(budgetId, month);

  return (
    <div className="target-view">
      <div className="target-summary">
        <div className="target-heading-block">{head}</div>
        {donut !== null && (
          <Donut percent={donut} tone={message?.tone === "positive" ? "positive" : "cautious"} />
        )}
      </div>
      {message && (
        <div className={`target-message is-${message.tone}`} role="status">
          <span>{message.text}</span>
          {message.assign !== null && (
            <button
              type="button"
              className="target-assign"
              disabled={assigning !== null}
              onClick={() => {
                if (assigning !== null) return;
                setAssignError(false);
                setAssigning(message.assign as number);
                void assign(c.id, c.assigned, c.assigned + (message.assign as number));
              }}
            >
              Assign
            </button>
          )}
        </div>
      )}
      {assignError && (
        <p className="target-error" role="alert">
          Couldn't assign.
        </p>
      )}
      <div className="target-breakdown">
        {breakdown.map((r) => (
          <div key={r.label}>
            {r.rule && <hr />}
            <div className="panel-row">
              <span className="panel-row-label">{r.label}</span>
              <span className="panel-row-value">{fmt.money(r.amount)}</span>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="target-edit" onClick={onEdit}>
        Edit Target
      </button>
      <div className="target-snooze">
        <Switch
          label={SNOOZE_LABEL}
          checked={c.target_snoozed}
          disabled={month !== localCurrentMonth() || snooze.waiting}
          onChange={(on) => snooze.toggle(c.id, on)}
        />
        <PanelTooltip
          align="end"
          text={
            <>
              <strong>{SNOOZE_TIP_TITLE}</strong>
              <br />
              {SNOOZE_TIP_BODY}
              {month !== localCurrentMonth() && (
                <>
                  <br />
                  {SNOOZE_ONLY_CURRENT}
                </>
              )}
            </>
          }
        >
          {(trigger) => (
            <button type="button" {...trigger} className="snooze-help" aria-label="About snoozing">
              <QuestionCircleIcon />
            </button>
          )}
        </PanelTooltip>
      </div>
    </div>
  );
}
