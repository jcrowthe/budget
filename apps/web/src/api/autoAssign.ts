import type { Month } from "@budget/core/month";
import {
  type AutoAssignPreview,
  AutoAssignPreviewResponse,
  AutoAssignResultResponse,
  type AutoAssignStrategy,
} from "@budget/schema/auto-assign";
import type { PlanView } from "@budget/schema/plan-views";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { apiFetch } from "./client";
import { beginWrite, endWrite, inOrder } from "./monthCache";
import { localToday } from "./today";

/** Which categories an option works on: exactly these, or the ones a Plan view shows. */
export type AutoAssignScope = { categoryIds: string[] } | { view: PlanView };

const scopeKey = (s: AutoAssignScope) =>
  "view" in s ? `view:${s.view}` : `ids:${[...s.categoryIds].sort().join(",")}`;

const scopeQuery = (s: AutoAssignScope) =>
  "view" in s ? `view=${s.view}` : `category_ids=${s.categoryIds.join(",")}`;

const base = (budgetId: string, month: Month): `/api/v1/${string}` =>
  `/api/v1/budgets/${budgetId}/months/${month}/auto-assign`;

export const getAutoAssignPreview = async (
  budgetId: string,
  month: Month,
  scope: AutoAssignScope,
): Promise<AutoAssignPreview> =>
  (
    await apiFetch(`${base(budgetId, month)}?${scopeQuery(scope)}&today=${localToday()}`, {
      schema: AutoAssignPreviewResponse,
    })
  ).data;

/** The Worker's previews. Every write of the plan refreshes them (monthCache.endWrite). */
export const useAutoAssignPreview = (
  budgetId: string,
  month: Month,
  scope: AutoAssignScope,
  enabled = true,
) =>
  useQuery({
    queryKey: ["auto-assign", budgetId, month, scopeKey(scope)],
    queryFn: () => getAutoAssignPreview(budgetId, month, scope),
    // No placeholder: figures of another selection are never shown (the card draws a skeleton instead).
    enabled,
  });

// Busy per plan and month: from the click until the month has been read again. Shared by every Auto-Assign
// button of that month (the card and the Assign popover), so a second click cannot apply with stale figures.
// `at` is the month query's read count when the POST answered; null while the POST is still out.
const busyKeys = new Map<string, { at: number | null; token: number }>();
let runs = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const isBusy = (key: string) => busyKeys.has(key);
/** The longest the buttons stay disabled if the month read never arrives. */
const BUSY_LIMIT_MS = 10_000;

export function useAutoAssign(budgetId: string, month: Month) {
  const qc = useQueryClient();
  const key = `${budgetId}:${month}`;
  const busy = useSyncExternalStore(subscribe, () => isBusy(key));
  const [failed, setFailed] = useState(false);
  // Subscribes to the month query, so a read that changes nothing still re-renders and ends `busy`.
  useQuery({ queryKey: ["month", budgetId, month], enabled: false });
  const reads = qc.getQueryState(["month", budgetId, month])?.dataUpdateCount ?? 0;

  useEffect(() => {
    const b = busyKeys.get(key);
    if (b && b.at !== null && reads > b.at) {
      busyKeys.delete(key);
      emit();
    }
  }, [key, reads]);

  const apply = useCallback(
    async (strategy: AutoAssignStrategy, scope: AutoAssignScope): Promise<boolean> => {
      if (isBusy(key)) return false;
      const token = ++runs;
      busyKeys.set(key, { at: null, token });
      emit();
      setFailed(false);
      const release = () => {
        busyKeys.delete(key);
        emit();
      };
      await beginWrite(qc, budgetId);
      try {
        await inOrder(budgetId, () =>
          apiFetch(`${base(budgetId, month)}?today=${localToday()}`, {
            method: "POST",
            body: {
              strategy,
              ...("view" in scope ? { view: scope.view } : { category_ids: scope.categoryIds }),
            },
            idempotencyKey: crypto.randomUUID(),
            schema: AutoAssignResultResponse,
          }),
        );
      } catch {
        setFailed(true);
        release();
        endWrite(qc, budgetId);
        return false;
      }
      busyKeys.set(key, {
        at: qc.getQueryState(["month", budgetId, month])?.dataUpdateCount ?? 0,
        token,
      });
      setTimeout(() => {
        // Only this run's own entry: a later run has its own token.
        if (busyKeys.get(key)?.token === token) release();
      }, BUSY_LIMIT_MS);
      endWrite(qc, budgetId);
      return true;
    },
    [qc, budgetId, month, key],
  );
  return { apply, busy, failed };
}
