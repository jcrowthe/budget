import type { UiStatePatch } from "@budget/schema/ui-state";
import { type UiState, UiStateResponse } from "@budget/schema/ui-state";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const getUiState = async (budgetId: string): Promise<UiState> =>
  (await apiFetch(`/api/v1/budgets/${budgetId}/ui-state`, { schema: UiStateResponse })).data
    .ui_state;

export const putUiState = async (budgetId: string, patch: UiStatePatch): Promise<UiState> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/ui-state`, {
      method: "PUT",
      body: patch,
      schema: UiStateResponse,
    })
  ).data.ui_state;

export const uiStateKey = (budgetId: string | undefined) => ["ui-state", budgetId];

export const useUiState = (budgetId: string | undefined) =>
  useQuery({
    queryKey: uiStateKey(budgetId),
    queryFn: () => getUiState(budgetId ?? ""),
    enabled: !!budgetId,
    staleTime: Number.POSITIVE_INFINITY,
  });

/** Saves run one after another; the screen updates at once; a failed save is silent. */
export function useSaveUiState(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: `ui-state:${budgetId}` },
    mutationFn: (patch: UiStatePatch) => putUiState(budgetId, patch),
    onMutate: (patch) => {
      qc.setQueryData<UiState>(uiStateKey(budgetId), (old) => ({ ...old, ...patch }));
    },
  });
}
