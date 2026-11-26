import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch,
  SettingsResponse,
} from "@budget/schema/settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const getSettings = async (): Promise<Settings> =>
  (await apiFetch("/api/v1/settings", { schema: SettingsResponse })).data;

export const patchSettings = async (patch: SettingsPatch): Promise<Settings> =>
  (await apiFetch("/api/v1/settings", { method: "PATCH", body: patch, schema: SettingsResponse }))
    .data;

export const settingsKey = ["settings"] as const;

/** localStorage key of the cached theme choice: the inline script in index.html reads it for the first paint. */
export const THEME_CACHE_KEY = "theme";

export function cacheTheme(theme: Settings["theme"]): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme);
  } catch {
    // Storage unavailable: the first paint is dark until the settings load.
  }
}

/** The signed-in user's saved display options (not per plan); the defaults until they load. */
export const useSettings = () =>
  useQuery({
    queryKey: settingsKey,
    queryFn: getSettings,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: DEFAULT_SETTINGS,
  });

/**
 * Saves run one after another; the screen updates at once and a failed save puts the old values back.
 * Settings writes are not on the plan undo stack (no `onChangeSet`).
 */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: "settings" },
    mutationFn: patchSettings,
    onMutate: async (patch: SettingsPatch) => {
      await qc.cancelQueries({ queryKey: settingsKey });
      const before = qc.getQueryData<Settings>(settingsKey);
      qc.setQueryData<Settings>(settingsKey, (old) => ({ ...(old ?? DEFAULT_SETTINGS), ...patch }));
      return { before };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.before) qc.setQueryData(settingsKey, ctx.before);
    },
    onSuccess: (saved) => {
      qc.setQueryData(settingsKey, saved);
      cacheTheme(saved.theme);
    },
  });
}
