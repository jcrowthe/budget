import {
  AccountViewSettingsResponse,
  AllAccountsViewSettingsResponse,
  mergeViewSettings,
  VIEW_DEFAULTS,
  type ViewSettings,
} from "@budget/schema/view-settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

/** `scope` is an account id, or "all" for All Accounts. */
const path = (budgetId: string, scope: string): `/api/v1/${string}` =>
  scope === "all"
    ? `/api/v1/budgets/${budgetId}/view_settings/all_accounts`
    : `/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(scope)}/view_settings`;

type Settings = ViewSettings;

const read = async (budgetId: string, scope: string): Promise<Settings> => {
  const res = await apiFetch(path(budgetId, scope), {
    schema: scope === "all" ? AllAccountsViewSettingsResponse : AccountViewSettingsResponse,
  });
  return { ...VIEW_DEFAULTS, ...res.data.view_settings };
};

/**
 * The key's second element is an object, so the plan-wide invalidations (`queryKey.includes(budgetId)`) never
 * refetch the settings: one request for them per page.
 */
export const viewSettingsKey = (budgetId: string, scope: string) =>
  ["view-settings", { budgetId, scope }] as const;

export const useViewSettings = (budgetId: string, scope: string) =>
  useQuery({
    queryKey: viewSettingsKey(budgetId, scope),
    queryFn: () => read(budgetId, scope),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

export type ViewSettingsPatch = Partial<Settings>;

/**
 * Saves run one after another; the page changes at once (the merge is the server's own) and a failed save puts
 * the old settings back. Nothing else is invalidated.
 */
export function useSaveViewSettings(budgetId: string, scope: string) {
  const qc = useQueryClient();
  const key = viewSettingsKey(budgetId, scope);
  return useMutation({
    scope: { id: `view-settings:${budgetId}:${scope}` },
    mutationFn: async (patch: ViewSettingsPatch) => {
      await apiFetch(path(budgetId, scope), {
        method: "PUT",
        body: patch,
        schema: scope === "all" ? AllAccountsViewSettingsResponse : AccountViewSettingsResponse,
      });
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Settings>(key);
      const merged = mergeViewSettings(previous ?? VIEW_DEFAULTS, patch);
      if (!("error" in merged)) qc.setQueryData<Settings>(key, merged);
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });
}
