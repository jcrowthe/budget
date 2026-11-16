import { useCallback, useState } from "react";

const KEY = "budget.planPanelWidth";
export const MIN_PANEL_WIDTH = 320;
export const MAX_PANEL_FRACTION = 0.6;

const read = (): number | null => {
  try {
    const n = Number(sessionStorage.getItem(KEY));
    return Number.isFinite(n) && n >= MIN_PANEL_WIDTH ? n : null;
  } catch {
    return null;
  }
};

/**
 * The panel's width in px, or null for the default (a third of the page). Kept for the browser session only:
 * a pixel width chosen in one window is wrong in another, and it is not worth a server setting.
 */
export function usePanelWidth(): [number | null, (px: number) => void] {
  const [width, setWidth] = useState<number | null>(read);
  const set = useCallback((px: number) => {
    const w = Math.round(px);
    setWidth(w);
    try {
      sessionStorage.setItem(KEY, String(w));
    } catch {
      // storage is unavailable: the width lasts until the page is left
    }
  }, []);
  return [width, set];
}
