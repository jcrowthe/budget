// The Progress Bars choice is the per-user `progress_bars` setting (EXF-472): the Plan toolbar toggle saves it
// at once, the Display Options dialog previews it and saves it on Apply.
import { useCallback } from "react";
import { useSaveSettings } from "../api/settings";
import { useEffectiveSettings } from "../settings/displayStore";

export function useProgressBars(): [boolean, (on: boolean) => void] {
  const { progress_bars } = useEffectiveSettings();
  const { mutate } = useSaveSettings();
  const set = useCallback((on: boolean) => mutate({ progress_bars: on }), [mutate]);
  return [progress_bars, set];
}
