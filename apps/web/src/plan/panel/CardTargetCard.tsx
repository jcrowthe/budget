import type { Month } from "@budget/core/month";
import {
  CARD_TARGET_LABELS,
  type CardTargetDraft,
  cardDraftFromTarget,
  cardDraftToBody,
  cardTargetBreakdown,
  cardTargetDonut,
  cardTargetHeading,
  cardTargetMessage,
  newCardDraft,
} from "@budget/schema/card-target";
import type { MonthCategoryDetail, MonthDetail } from "@budget/schema/months";
import { yearOptions } from "@budget/schema/target-form";
import type { CardTargetType } from "@budget/schema/targets";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useCommitAssigned } from "../../api/assigned";
import { useDeleteTarget, useSaveTarget } from "../../api/targets";
import { localToday } from "../../api/today";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { TargetRingIcon, TrashIcon } from "../icons";
import { useDismiss } from "../useDismiss";
import { PanelCard } from "./PanelCard";
import { Donut } from "./TargetCard";
import { MONTH_NAMES, TargetAmountField, withYear } from "./TargetForm";
import "./target.css";

const KINDS = Object.keys(CARD_TARGET_LABELS) as CardTargetType[];

/**
 * The target of a credit card payment category (EXF-538): the editor (opened by `startOpen` for a new target),
 * or the target's state: heading, donut, message with Assign, breakdown, Edit Target.
 */
export function CardTargetCard({
  budgetId,
  month,
  category: c,
  startOpen = false,
  onClose,
}: {
  budgetId: string;
  month: Month;
  category: MonthCategoryDetail;
  /** Open the editor on a fresh draft (the Payment card's Create button). */
  startOpen?: boolean;
  onClose?: () => void;
}) {
  const fmt = usePlanFormatter();
  const qc = useQueryClient();
  const today = localToday();
  const [draft, setDraft] = useState<CardTargetDraft | null>(
    startOpen ? newCardDraft(today) : null,
  );
  const [errors, setErrors] = useState<{ amount?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const [assignError, setAssignError] = useState(false);
  const [assigning, setAssigning] = useState<number | null>(null);
  const save = useSaveTarget(budgetId);
  const del = useDeleteTarget(budgetId);
  const assign = useCommitAssigned(budgetId, month, () => {
    setAssigning(null);
    setAssignError(true);
  });
  useQuery<MonthDetail>({ queryKey: ["month", budgetId, month], enabled: false });
  const reads = qc.getQueryState(["month", budgetId, month])?.dataUpdateCount ?? 0;
  const succeeded = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const busy = waitingFor !== null;

  const close = () => {
    setDraft(null);
    onClose?.();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes the editor when the refetched month arrives
  useEffect(() => {
    if (waitingFor !== null && succeeded.current && reads !== waitingFor) {
      setWaitingFor(null);
      succeeded.current = false;
      close();
    }
  }, [reads, waitingFor]);

  const toGo = cardTargetMessage(c, fmt)?.assign ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: clears when the figure changes
  useEffect(() => {
    setAssigning((a) => (a !== null && a !== toGo ? null : a));
  }, [toGo]);

  // Escape and a press outside the open editor cancel it; a write in flight finishes first.
  useDismiss(box, () => {
    if (draft && !busy) close();
  });

  const submit = (action: () => Promise<unknown>, message: string) => {
    succeeded.current = false;
    setFailure(null);
    setWaitingFor(reads);
    action().then(
      () => {
        succeeded.current = true;
        const now = qc.getQueryState(["month", budgetId, month])?.dataUpdateCount ?? 0;
        if (now !== reads) {
          setWaitingFor(null);
          close();
        }
      },
      () => {
        setWaitingFor(null);
        setFailure(message);
      },
    );
  };

  if (draft) {
    const set = (patch: Partial<CardTargetDraft>) => setDraft((d) => d && { ...d, ...patch });
    return (
      <PanelCard id="panel-target" title="Target" ruled>
        <div className="target-form" ref={box} aria-busy={busy || undefined}>
          <dl className="target-block">
            <dt id="card-target-type">Target</dt>
            <dd>
              <span className="select-wrap">
                <select
                  className="target-select"
                  aria-label="Target"
                  disabled={busy}
                  value={draft.type}
                  onChange={(e) => set({ type: e.target.value as CardTargetType })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CARD_TARGET_LABELS[k]}
                    </option>
                  ))}
                </select>
              </span>
            </dd>
          </dl>
          {draft.type === "card_monthly" ? (
            <>
              <dl className="target-block">
                <dt>Amount</dt>
                <dd>
                  <TargetAmountField
                    value={draft.amount}
                    onChange={(amount) => set({ amount })}
                    disabled={busy}
                    invalid={!!errors.amount}
                  />
                </dd>
              </dl>
              {errors.amount && (
                <p className="target-error" role="alert">
                  {errors.amount}
                </p>
              )}
            </>
          ) : (
            <dl className="target-block">
              <dt>Pay off by</dt>
              <dd>
                <div className="target-pair">
                  <span className="select-wrap">
                    <select
                      className="target-select month-select"
                      aria-label="Select Month"
                      disabled={busy}
                      value={draft.month}
                      onChange={(e) => set({ month: Number(e.target.value) })}
                    >
                      {MONTH_NAMES.map((m, i) => (
                        <option key={m} value={i}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="select-wrap year-wrap">
                    <select
                      className="target-select year-select"
                      aria-label="Select Year"
                      disabled={busy}
                      value={draft.year}
                      onChange={(e) => set({ year: Number(e.target.value) })}
                    >
                      {withYear(yearOptions(today), draft.year).map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
              </dd>
            </dl>
          )}
          {failure && (
            <p className="target-error" role="alert">
              {failure}
            </p>
          )}
          <div className="target-actions">
            <button
              type="button"
              className="target-delete"
              disabled={busy}
              onClick={() => {
                if (!c.target) close();
                else submit(() => del.mutateAsync(c.id), "Couldn't delete the target.");
              }}
            >
              <TrashIcon width={16} height={16} />
              Delete
            </button>
            <span className="target-actions-end">
              <button type="button" className="target-cancel" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="target-save"
                disabled={busy}
                onClick={() => {
                  const r = cardDraftToBody(draft, fmt);
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
              >
                Save Target
              </button>
            </span>
          </div>
        </div>
      </PanelCard>
    );
  }

  const t = c.target;
  const head = cardTargetHeading(c, fmt);
  if (!t || !head) return null;
  const message = cardTargetMessage(c, fmt);
  const donut = cardTargetDonut(c);
  return (
    <PanelCard
      id="panel-target"
      title="Target"
      icon={<TargetRingIcon className="target-ring-icon" width={16} height={16} />}
    >
      <div className="target-view">
        <div className="target-summary">
          <div className="target-heading-block">
            {head.label && <p className="target-subheading">{head.label}</p>}
            <h3 className="target-heading">{head.heading}</h3>
            <p className="target-subheading">{head.subheading}</p>
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
          {cardTargetBreakdown(c).map((r) => (
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
          onClick={() => {
            setErrors({});
            setFailure(null);
            setDraft(cardDraftFromTarget(t.definition, today));
          }}
        >
          Edit Target
        </button>
      </div>
    </PanelCard>
  );
}
