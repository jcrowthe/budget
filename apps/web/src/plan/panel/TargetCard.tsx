import type { Month } from "@budget/core/month";
import type { MonthCategoryDetail, MonthDetail } from "@budget/schema/months";
import {
  draftFromTarget,
  draftToBody,
  newDraft,
  type TargetDraft,
} from "@budget/schema/target-form";
import {
  SNOOZE_LABEL,
  SNOOZE_ONLY_CURRENT,
  SNOOZE_TIP_BODY,
  SNOOZE_TIP_TITLE,
  targetBreakdown,
  targetDonut,
  targetEmptyText,
  targetHeading,
  targetMessage,
} from "@budget/schema/target-wording";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useCommitAssigned } from "../../api/assigned";
import { useDeleteTarget, useSaveTarget } from "../../api/targets";
import { localToday } from "../../api/today";
import { localCurrentMonth } from "../../shell/planPaths";

import { QuestionCircleIcon, TargetRingIcon } from "../icons";
import { useToggleSnooze } from "../snooze";
import { PanelCard } from "./PanelCard";
import { PanelTooltip } from "./PanelTooltip";
import { Switch } from "./Switch";
import { TargetForm } from "./TargetForm";
import "./target.css";
import { usePlanFormatter } from "../../shell/plan-formats-context";

/** The donut: the percentage as a ring, yellow while the target is short and green once it is met or on track. */
function Donut({ percent, tone }: { percent: number; tone: "cautious" | "positive" }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className={`target-donut is-${tone}`}
      width="64"
      height="64"
      viewBox="0 0 64 64"
      role="img"
      aria-label={`${percent}% funded`}
    >
      <circle className="donut-track" cx="32" cy="32" r={r} />
      <circle
        className="donut-fill"
        cx="32"
        cy="32"
        r={r}
        strokeDasharray={`${(c * percent) / 100} ${c}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className="donut-text">
        {percent}%
      </text>
    </svg>
  );
}

/**
 * The inspector's Target card: an empty state with Create Target, the form, or the target's state (heading,
 * donut, message with Assign, breakdown, Edit Target). Keyed by the category, so another selection drops a draft.
 */
export function TargetCard({
  budgetId,
  month,
  category: c,
  collapsed,
  onToggle,
}: {
  budgetId: string;
  month: Month;
  category: MonthCategoryDetail;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const fmt = usePlanFormatter();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<TargetDraft | null>(null);
  const [errors, setErrors] = useState<{ amount?: string; date?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  // The form stays disabled from Save or Delete until the month has been read again (it carries the figures).
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const save = useSaveTarget(budgetId);
  const del = useDeleteTarget(budgetId);
  const [assignError, setAssignError] = useState(false);
  // The to-go the Assign button has added; the button stays disabled until the month read shows another figure.
  const [assigning, setAssigning] = useState<number | null>(null);
  const assign = useCommitAssigned(budgetId, month, () => {
    setAssigning(null);
    setAssignError(true);
  });
  // Subscribes the card to the month query, so a refetch that changes nothing still re-renders it.
  useQuery<MonthDetail>({ queryKey: ["month", budgetId, month], enabled: false });
  const reads = qc.getQueryState(["month", budgetId, month])?.dataUpdateCount ?? 0;
  const succeeded = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: closes the form when the refetched month arrives
  useEffect(() => {
    if (waitingFor !== null && succeeded.current && reads !== waitingFor) {
      setWaitingFor(null);
      setDraft(null);
      succeeded.current = false;
    }
  }, [reads, waitingFor]);

  // A new to-go figure means the month was read again after the Assign.
  const toGo = targetMessage(c, fmt)?.assign ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: clears when the figure changes
  useEffect(() => {
    setAssigning((a) => (a !== null && a !== toGo ? null : a));
  }, [toGo]);

  const snooze = useToggleSnooze(budgetId, month);
  const today = localToday();
  const busy = waitingFor !== null;
  const open = (d: TargetDraft) => {
    setErrors({});
    setFailure(null);
    setDraft(d);
  };
  const submit = (action: () => Promise<unknown>, message: string) => {
    succeeded.current = false;
    setFailure(null);
    setWaitingFor(reads);
    action().then(
      () => {
        succeeded.current = true;
        // The refetch may already have landed.
        const now = qc.getQueryState(["month", budgetId, month])?.dataUpdateCount ?? 0;
        if (now !== reads) {
          setWaitingFor(null);
          setDraft(null);
        }
      },
      () => {
        setWaitingFor(null);
        setFailure(message);
      },
    );
  };

  if (draft) {
    return (
      <PanelCard id="panel-target" title="Target" ruled>
        <TargetForm
          draft={draft}
          onDraft={(f) => setDraft((d) => d && f(d))}
          today={today}
          errors={errors}
          busy={busy}
          failure={failure}
          onCancel={() => setDraft(null)}
          onDelete={() => {
            if (!c.target) setDraft(null);
            else submit(() => del.mutateAsync(c.id), "Couldn't delete the target.");
          }}
          onSave={() => {
            const r = draftToBody(draft, today, fmt);
            if ("errors" in r) {
              setErrors(r.errors);
              return;
            }
            setErrors({});
            submit(
              () => save.mutateAsync({ categoryId: c.id, body: r.body }),
              "Couldn't save the target.",
            );
          }}
        />
      </PanelCard>
    );
  }

  const t = c.target;
  if (!t) {
    const text = targetEmptyText(c.name);
    return (
      <PanelCard id="panel-target" title="Target" collapsed={collapsed} onToggle={onToggle}>
        <div className="target-empty">
          <strong>{text.question}</strong>
          <p>{text.body}</p>
          <button
            type="button"
            className="target-create"
            onClick={() => open(newDraft(today, fmt))}
          >
            Create Target
          </button>
        </div>
      </PanelCard>
    );
  }

  const { heading, subheading } = targetHeading(t, fmt);
  const message = targetMessage(c, fmt);
  const donut = targetDonut(c);
  return (
    <PanelCard
      id="panel-target"
      title="Target"
      collapsed={collapsed}
      onToggle={onToggle}
      icon={<TargetRingIcon className="target-ring-icon" width={16} height={16} />}
    >
      <div className="target-view">
        <div className="target-summary">
          <div className="target-heading-block">
            <h3 className="target-heading">{heading}</h3>
            <p className="target-subheading">{subheading}</p>
          </div>
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
          {targetBreakdown(c).map((r) => (
            <div key={r.label}>
              {r.rule && <hr />}
              <div className="panel-row">
                <span className="panel-row-label">{r.label}</span>
                <span className="panel-row-value">{fmt.money(r.amount)}</span>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="target-edit"
          onClick={() => open(draftFromTarget(t.definition, today, fmt))}
        >
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
              <button
                type="button"
                {...trigger}
                className="snooze-help"
                aria-label="About snoozing"
              >
                <QuestionCircleIcon />
              </button>
            )}
          </PanelTooltip>
        </div>
      </div>
    </PanelCard>
  );
}
