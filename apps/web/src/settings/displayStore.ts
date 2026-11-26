import { DEFAULT_SETTINGS, type Settings } from "@budget/schema/settings";
import { useSyncExternalStore } from "react";
import { useSettings } from "../api/settings";

// The Display Options dialog previews a choice before it is saved: `preview` sits over the saved settings
// until Apply (saved, then cleared) or Cancel (cleared).
let preview: Partial<Settings> | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const setPreview = (patch: Partial<Settings>) => {
  preview = { ...preview, ...patch };
  emit();
};
export const clearPreview = () => {
  if (preview === null) return;
  preview = null;
  emit();
};
export const usePreview = () => useSyncExternalStore(subscribe, () => preview);

/** Defaults, over the saved settings, over the preview. */
export function useEffectiveSettings(): Settings {
  const { data } = useSettings();
  const p = usePreview();
  return { ...DEFAULT_SETTINGS, ...data, ...p };
}
