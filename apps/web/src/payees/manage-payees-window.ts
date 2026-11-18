import { type RefObject, useCallback, useLayoutEffect, useState } from "react";

const OVERSCAN = 10;

/** The rows of a fixed-height list that are near the visible part: `start` to `end` and the spacers around them. */
export function useWindowedRows(
  count: number,
  rowHeight: number,
  scroller: RefObject<HTMLElement | null>,
) {
  const [view, setView] = useState({ top: 0, height: 600 });
  const measure = useCallback(() => {
    const el = scroller.current;
    if (el) setView({ top: el.scrollTop, height: el.clientHeight || 600 });
  }, [scroller]);
  useLayoutEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure, scroller]);
  const start = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN);
  const end = Math.min(count, Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
    measure,
  };
}
