import { type RefObject, useEffect, useState } from "react";

/** The panel never gets narrower than this (`--panel-min` in plan-grid.css). */
export const PANEL_MIN = 320;
/** The grid's content never gets narrower than this (`--grid-min`); a narrower box scrolls inside itself. */
export const GRID_MIN = 428;
/** Under this grid box width the number columns take fixed minimums (`data-narrow`). */
export const NARROW_BELOW = 562;
/** Under this Plan body width the panel is folded away: it would leave the grid under 300px. */
export const FOLD_BELOW = 620;

export interface PlanLayout {
  fold: boolean;
  narrow: boolean;
}

/** The layout of the Plan body: `body` is its width, `grid` the grid box's. */
export const planLayout = (body: number, grid: number): PlanLayout => ({
  fold: body < FOLD_BELOW,
  narrow: grid < NARROW_BELOW,
});

/**
 * Watches the Plan body and its grid with one ResizeObserver and returns the attributes for `.plan-body`
 * (`data-fold`, `data-narrow`). It is a hook, not a CSS container query, because Plan popovers are
 * `position: fixed` without a portal and a container would trap them.
 */
export function usePlanLayout(ref: RefObject<HTMLElement | null>): {
  "data-fold"?: "";
  "data-narrow"?: "";
} {
  const [layout, setLayout] = useState<PlanLayout>({ fold: false, narrow: false });
  useEffect(() => {
    const body = ref.current;
    if (!body || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const grid = body.querySelector<HTMLElement>(":scope > .plan-grid");
      const next = planLayout(body.clientWidth, grid?.clientWidth ?? body.clientWidth);
      setLayout((l) => (l.fold === next.fold && l.narrow === next.narrow ? l : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    const grid = body.querySelector(":scope > .plan-grid");
    if (grid) ro.observe(grid);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  return {
    ...(layout.fold ? { "data-fold": "" as const } : {}),
    ...(layout.narrow ? { "data-narrow": "" as const } : {}),
  };
}
