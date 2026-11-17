import type { MonthDetail } from "@budget/schema/months";
import type { PlanFormatter } from "@budget/schema/plan-formats";
import { useEffect, useMemo, useState } from "react";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { categoryPill } from "./format";

/** What the three number columns of the grid need to show this month's figures whole, in px. */
export interface NumberColumns {
  assigned: number;
  activity: number;
  available: number;
}

// Floors: the header labels (12px, caps, letter-spaced) and the PAYMENT button of the Credit Card Payments group.
const FLOOR = { assigned: 68, activity: 62, available: 80 };
// The Assigned cell: a hover calculator button (18px) before the amount, 2px of border and the amount button's own
// 3px of padding on each side.
const ASSIGNED_EXTRA = 18 + 2 + 6;
// The Activity cell: padding 2px on the right.
const ACTIVITY_EXTRA = 2;
// The pill: padding 7px twice, its icon (13-14px) and the gap after it.
const PILL_PADDING = 14;
const PILL_ICON = 19;
// A group row's cells: Assigned 4px of padding, Activity 2px, Available 4px and, in the payment group, the PAYMENT
// button (icon, label).
const GROUP_ASSIGNED = 4;
const GROUP_ACTIVITY = 2;
const GROUP_AVAILABLE = 4;
const PAYMENT_BUTTON = 76;
// Tabular digits and a font that may not be loaded yet: a little room.
const SLACK = 0;
// EXF-726: an amount of up to twelve characters ("−$000,000.00") shows whole; a longer one is cut by its column.
const CAP_TEXT = "−$000,000.00";

let canvas: CanvasRenderingContext2D | null = null;
const textWidth = (text: string, font: string): number => {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return text.length * 9;
  canvas.font = font;
  return canvas.measureText(text).width;
};

/** The columns' widths from the month's figures: the widest amount of each, never below the floors. */
export function numberColumns(
  detail: MonthDetail | undefined,
  family: string,
  fmt: PlanFormatter,
): NumberColumns {
  const font = `500 14px ${family}`;
  // The digits are tabular on screen but not on the canvas: measure every digit as a 0, the widest one.
  const w = (n: number) => textWidth(fmt.money(n).replace(/\d/g, "0"), font);
  const cols = { ...FLOOR };
  if (!detail) return cols;
  const cap = textWidth(CAP_TEXT, font);
  const caps: NumberColumns = {
    assigned: Math.ceil(cap + Math.max(ASSIGNED_EXTRA, GROUP_ASSIGNED) + SLACK),
    activity: Math.ceil(cap + Math.max(ACTIVITY_EXTRA, GROUP_ACTIVITY) + SLACK),
    available: Math.ceil(cap + Math.max(PILL_PADDING + PILL_ICON, GROUP_AVAILABLE) + SLACK),
  };
  const grow = (k: keyof NumberColumns, px: number) => {
    cols[k] = Math.max(cols[k], Math.min(Math.ceil(px + SLACK), caps[k]));
  };
  for (const g of detail.groups) {
    if (g.hidden) continue;
    grow("assigned", w(g.assigned) + GROUP_ASSIGNED);
    grow("activity", w(g.activity) + GROUP_ACTIVITY);
    grow("available", Math.max(w(g.available), g.kind ? PAYMENT_BUTTON : 0) + GROUP_AVAILABLE);
    for (const c of g.categories) {
      if (c.hidden) continue;
      grow("assigned", w(c.assigned) + ASSIGNED_EXTRA);
      grow("activity", w(c.activity) + ACTIVITY_EXTRA);
      grow(
        "available",
        w(c.available) + PILL_PADDING + (categoryPill(c, fmt)?.icon ? PILL_ICON : 0),
      );
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
  const fmt = usePlanFormatter();
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
    const c = numberColumns(detail, family, fmt);
    return {
      "--col-assigned": `${c.assigned}px`,
      "--col-activity": `${c.activity}px`,
      "--col-available": `${c.available}px`,
    } as React.CSSProperties;
  }, [detail, family, fmt]);
}
