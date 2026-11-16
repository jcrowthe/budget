import { type PointerEvent, type RefObject, useEffect, useState } from "react";
import { MAX_PANEL_FRACTION, MIN_PANEL_WIDTH } from "./panelWidth";

const clamp = (px: number, body: number) =>
  Math.round(Math.min(body * MAX_PANEL_FRACTION, Math.max(MIN_PANEL_WIDTH, px)));

/** The drag handle on the panel's left edge: pointer drag, or ←/→ by 16 px when focused. */
export function ResizeHandle({
  bodyRef,
  panelRef,
  width,
  onWidth,
}: {
  bodyRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  /** The stored width; null while the panel has its default. */
  width: number | null;
  onWidth: (px: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  // The measured width and the widest allowed, for assistive technology (the default width is a percentage).
  const [range, setRange] = useState<{ now: number; max: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are stable; the stored width is the trigger
  useEffect(() => {
    const measure = () => {
      const p = panelRef.current?.getBoundingClientRect().width;
      const b = bodyRef.current?.getBoundingClientRect().width;
      if (p !== undefined && b !== undefined) {
        setRange({ now: Math.round(p), max: Math.round(b * MAX_PANEL_FRACTION) });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (panelRef.current) ro.observe(panelRef.current);
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [width]);
  const body = () => bodyRef.current?.getBoundingClientRect();
  const move = (e: PointerEvent) => {
    const b = body();
    if (b) onWidth(clamp(b.right - e.clientX, b.width));
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a vertical splitter has no native element
    <div
      className={`panel-resizer${dragging ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={range?.now}
      aria-valuemin={MIN_PANEL_WIDTH}
      aria-valuemax={range?.max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => dragging && move(e)}
      onPointerUp={(e) => {
        if (dragging) move(e);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        const b = body();
        const now = panelRef.current?.getBoundingClientRect().width;
        if (!b || now === undefined || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        e.stopPropagation();
        onWidth(clamp(now + (e.key === "ArrowLeft" ? 16 : -16), b.width));
      }}
    >
      <span className="panel-resizer-indicator" />
    </div>
  );
}
