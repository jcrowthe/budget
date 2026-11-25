import type { Month } from "@budget/core/month";
import {
  CREATE_DEBT_TARGET,
  DEBT_TARGET_TITLE,
  type DebtDraft,
  debtDraftFromTarget,
  debtDraftToBody,
  debtTargetHeading,
  newDebtDraft,
} from "@budget/schema/debt-target";
import type { MonthCategoryDetail, MonthDetail } from "@budget/schema/months";
import { targetBreakdown, targetDonut, targetMessage } from "@budget/schema/target-wording";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAccounts } from "../../api/accounts";
import { useDeleteTarget, useSaveTarget } from "../../api/targets";
import { localToday } from "../../api/today";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { TargetRingIcon } from "../icons";
import { DebtTargetForm } from "./DebtTargetForm";
import { PanelCard } from "./PanelCard";
import { TargetSavedView } from "./TargetSavedView";
import "./target.css";

/**
 * The Target card of a loan's paired category (EXF-545): Create Debt Payment Target, the editor, or the saved
 * Monthly Debt Payment. Keyed by the category, so another selection drops a draft.
 */
export function DebtTargetCard({
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
  const accounts = useAccounts(budgetId);
  const loan = accounts.data?.find((a) => a.id === c.paired_account_id);
  const [draft, setDraft] = useState<DebtDraft | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  // The form stays disabled from Save or Delete until the month has been read again (it carries the figures).
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const save = useSaveTarget(budgetId);
  const del = useDeleteTarget(budgetId);
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

  if (!loan) return null;
  const today = localToday();
  const busy = waitingFor !== null;
  const open = (d: DebtDraft) => {
    setError(undefined);
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
      <PanelCard id="panel-target" title={DEBT_TARGET_TITLE} ruled>
        <DebtTargetForm
          loan={loan}
          currentMonth={`${today.slice(0, 7)}-01` as Month}
          draft={draft}
          onDraft={(patch) => setDraft((d) => d && { ...d, ...patch })}
          error={error}
          busy={busy}
          failure={failure}
          canDelete={!!c.target}
          onCancel={() => setDraft(null)}
          onDelete={() => submit(() => del.mutateAsync(c.id), "Couldn't delete the target.")}
          onSave={() => {
            const r = debtDraftToBody(draft, fmt);
            if ("errors" in r) {
              setError(r.errors.amount);
              return;
            }
            setError(undefined);
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
    return (
      <PanelCard id="panel-target" title="Target" collapsed={collapsed} onToggle={onToggle}>
        <div className="target-empty">
          <button
            type="button"
            className="target-create"
            onClick={() => open(newDebtDraft(loan.minimum_payment ?? 0))}
          >
            {CREATE_DEBT_TARGET}
          </button>
        </div>
      </PanelCard>
    );
  }

  const head = debtTargetHeading(t.definition, fmt);
  return (
    <PanelCard
      id="panel-target"
      title="Target"
      collapsed={collapsed}
      onToggle={onToggle}
      icon={<TargetRingIcon className="target-ring-icon" width={16} height={16} />}
    >
      <TargetSavedView
        budgetId={budgetId}
        month={month}
        c={c}
        head={
          <>
            <p className="target-label">{head.label}</p>
            <h3 className="target-heading">{head.heading}</h3>
            <p className="target-subheading">{head.subheading}</p>
            <p className="target-subheading">{head.by}</p>
          </>
        }
        message={targetMessage(c, fmt)}
        donut={targetDonut(c)}
        breakdown={targetBreakdown(c)}
        onEdit={() => open(debtDraftFromTarget(t.definition))}
      />
    </PanelCard>
  );
}
