// The Progress Bars choice. Kept in the browser until EXF-472 (Display Options) owns the per-user setting:
// THEN `loadProgressBars` and `saveProgressBars` (or the hook) are replaced by its settings query and mutation.
import { useCallback, useState } from "react";

const KEY = "budget.progressBars";

export function loadProgressBars(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveProgressBars(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage unavailable: the choice lasts until reload.
  }
}

export function useProgressBars(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(loadProgressBars);
  const set = useCallback((v: boolean) => {
    setOn(v);
    saveProgressBars(v);
  }, []);
  return [on, set];
}
