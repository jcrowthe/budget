import type { MonthDetail } from "@budget/schema/months";
import { useEffect, useMemo, useState } from "react";
import { categoryPill, money } from "./format";

/** What the three number columns of the grid need to show this month's figures whole, in px. */
export interface NumberColumns {
  assigned: number;
  activity: number;
  available: number;
}

// Floors: the header labels (12px, caps, letter-spaced) and the PAYMENT button of the Credit Card Payments group.
const FLOOR = { assigned: 68, activity: 62, available: 80 };
// The Assigned cell: a hover calculator button (18px) before the amount, 4px of padding, 2px of border.
const ASSIGNED_EXTRA = 18 + 4 + 2;
// The Activity cell: padding 4px + 2px.
const ACTIVITY_EXTRA = 6;
// The pill: padding 7px twice, its icon (13-14px) and the gap after it.
const PILL_PADDING = 14;
const PILL_ICON = 19;
// A group row's Available cell: 6px of padding and, in the payment group, the PAYMENT button (icon, label).
const GROUP_PADDING = 6;
const PAYMENT_BUTTON = 84;
// Tabular digits and a font that may not be loaded yet: a little room.
const SLACK = 4;

let canvas: CanvasRenderingContext2D | null = null;
const textWidth = (text: string, font: string): number => {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return text.length * 9;
  canvas.font = font;
  return canvas.measureText(text).width;
};

/** The columns' widths from the month's figures: the widest amount of each, never below the floors. */
export function numberColumns(detail: MonthDetail | undefined, family: string): NumberColumns {
  const font = `500 14px ${family}`;
  const w = (n: number) => textWidth(money(n), font);
  const cols = { ...FLOOR };
  if (!detail) return cols;
  const grow = (k: keyof NumberColumns, px: number) => {
    cols[k] = Math.max(cols[k], Math.ceil(px + SLACK));
  };
  for (const g of detail.groups) {
    if (g.hidden) continue;
    grow("assigned", w(g.assigned) + GROUP_PADDING);
    grow("activity", w(g.activity) + GROUP_PADDING);
    grow("available", Math.max(w(g.available), g.kind ? PAYMENT_BUTTON : 0) + GROUP_PADDING);
    for (const c of g.categories) {
      if (c.hidden) continue;
      grow("assigned", w(c.assigned) + ASSIGNED_EXTRA);
      grow("activity", w(c.activity) + ACTIVITY_EXTRA);
      grow("available", w(c.available) + PILL_PADDING + (categoryPill(c)?.icon ? PILL_ICON : 0));
    }
  }
  if (detail.uncategorized) {
    grow("activity", w(detail.uncategorized.activity) + ACTIVITY_EXTRA);
    grow("available", w(detail.uncategorized.available) + PILL_PADDING);
  }
  return cols;
}

/** The custom properties `--col-assigned`, `--col-activity` and `--col-available` (used by the narrow layout). */
export function useNumberColumns(detail: MonthDetail | undefined): React.CSSProperties {
  const [family, setFamily] = useState(() =>
    typeof document === "undefined"
      ? "sans-serif"
      : getComputedStyle(document.body).fontFamily || "sans-serif",
  );
  useEffect(() => {
    // Measured again once the web font is in.
    void document.fonts?.ready.then(() =>
      setFamily(getComputedStyle(document.body).fontFamily || "sans-serif"),
    );
  }, []);
  return useMemo(() => {
    const c = numberColumns(detail, family);
    return {
      "--col-assigned": `${c.assigned}px`,
      "--col-activity": `${c.activity}px`,
      "--col-available": `${c.available}px`,
    } as React.CSSProperties;
  }, [detail, family]);
}
