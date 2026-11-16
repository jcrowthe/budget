import type { Month } from "@budget/core/month";
import type { MonthDetail } from "@budget/schema/months";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useSnoozeTarget } from "../api/targets";
import { useSaveUiState, useUiState } from "../api/ui-state";

// The keyboard tip is shown once, after the first toggle by any path; the page draws it (KeyboardTip).
let tipVisible = false;
const listeners = new Set<() => void>();
const setTip = (on: boolean) => {
  if (on === tipVisible) return;
  tipVisible = on;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useTipVisible = () =>
  useSyncExternalStore(
    subscribe,
    () => tipVisible,
    () => false,
  );
export const hideTip = () => setTip(false);

/**
 * Snoozes or unsnoozes a target. `waiting` is true from the toggle until the month has been read again (there
 * is no optimistic write), so a second toggle cannot be sent with the old figures.
 */
export function useToggleSnooze(budgetId: string, month: Month) {
  const qc = useQueryClient();
  const snooze = useSnoozeTarget(budgetId);
  const ui = useUiState(budgetId).data;
  const saveUi = useSaveUiState(budgetId);
  const [at, setAt] = useState<number | null>(null);
  useQuery<MonthDetail>({ queryKey: ["month", budgetId, month], enabled: false });
  const reads = qc.getQueryState(["month", budgetId, month])?.dataUpdateCount ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the read count is the trigger
  useEffect(() => {
    if (at !== null && !snooze.isPending && (snooze.isError || reads > at)) setAt(null);
  }, [reads, at, snooze.isPending, snooze.isError]);
  const waiting = at !== null;
  const toggle = (categoryId: string, snoozed: boolean) => {
    if (waiting) return;
    setAt(reads);
    snooze.mutate({ month, categoryId, snoozed });
    if (ui && ui.snooze_tip_seen !== true) {
      setTip(true);
      saveUi.mutate({ snooze_tip_seen: true });
    }
  };
  return { toggle, waiting };
}
