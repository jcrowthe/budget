import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ARROW_W = 30;
const ARROW_H = 15;
const MARGIN = 8;

/**
 * A box below its anchor, centred on it, with an up-arrow on its top edge (measured on the source: box top =
 * anchor bottom + 15). Escape closes it and returns focus to the anchor; a click outside does nothing, as in the
 * source (a transparent overlay catches it). `dismissOnOutside` makes a mousedown on that overlay close it
 * (the Ready to Assign breakdown); `gap` is the distance from anchor to box (default 15).
 */
export function Popover({
  anchor,
  width,
  label,
  onClose,
  className,
  dismissOnOutside,
  scrim,
  alignTo,
  gap = ARROW_H,
  placement = "below",
  children,
}: {
  anchor: HTMLElement;
  width: number;
  label: string;
  onClose: () => void;
  className?: string;
  dismissOnOutside?: boolean;
  /** A dimmed overlay (the Ready to Assign breakdown); others keep it transparent. */
  scrim?: boolean;
  /** Centre horizontally on this element instead of the anchor (the vertical placement still follows the anchor). */
  alignTo?: HTMLElement;
  gap?: number;
  /** "above": the box sits over the anchor with a down-arrow (a dropdown or calendar); flips below when there is no room. */
  placement?: "below" | "above";
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Measured at render, so the first paint is already in place and the input can take focus on mount.
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    // The natural height: the content's own, even while a max-height is squeezing it.
    const h = box.current
      ? box.current.offsetHeight +
        (inner.current ? inner.current.scrollHeight - inner.current.clientHeight : 0)
      : 0;
    const spaceAbove = r.top - gap - MARGIN;
    const spaceBelow = window.innerHeight - r.bottom - gap - MARGIN;
    let above: boolean;
    let maxHeight: number | null = null;
    if (placement === "above") {
      // Over the anchor; below it when only there it fits; scrolled inside the roomier side when neither fits.
      above = h <= spaceAbove || (h > spaceBelow && spaceAbove >= spaceBelow);
      if (h > (above ? spaceAbove : spaceBelow))
        maxHeight = Math.max(0, above ? spaceAbove : spaceBelow);
    } else {
      // Below the anchor; above it when the box would run off the bottom of the window.
      above = r.bottom + gap + h > window.innerHeight - MARGIN && r.top - gap - h >= MARGIN;
    }
    const shown = maxHeight === null ? h : maxHeight;
    const a = alignTo?.getBoundingClientRect() ?? r;
    const centre = a.left + a.width / 2;
    const w = Math.min(width, window.innerWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(centre - w / 2, window.innerWidth - w - MARGIN));
    const arrow = Math.max(8, Math.min(centre - left - ARROW_W / 2, w - ARROW_W - 8));
    return { left, top: above ? r.top - gap - shown : r.bottom + gap, arrow, above, maxHeight };
  };
  const [pos, setPos] = useState(place);

  // biome-ignore lint/correctness/useExhaustiveDependencies: place reads only anchor and width
  useLayoutEffect(() => {
    const measure = () => setPos(place());
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor, width, gap, alignTo, placement]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && box.current) {
        // Focus trap: Tab and Shift+Tab wrap between the first and last tabbable inside the popover.
        const items = [
          ...box.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])",
          ),
        ];
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        const at = document.activeElement;
        if (!box.current.contains(at)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && at === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
      anchor.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anchor]);

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the overlay only catches an outside mousedown; Escape is the keyboard route
    <div
      className={`popover-overlay${scrim ? " has-scrim" : ""}`}
      onMouseDown={(e) => {
        if (dismissOnOutside && e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div
        ref={box}
        className={`popover${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          width,
          maxWidth: `calc(100vw - ${2 * MARGIN}px)`,
          left: pos.left,
          top: pos.top,
        }}
      >
        <svg
          className={`popover-arrow${pos.above ? " is-down" : ""}`}
          width={ARROW_W}
          height={ARROW_H}
          viewBox="0 0 30 15"
          style={{ left: pos.arrow }}
          aria-hidden="true"
        >
          <path d="M0 15 15 0 30 15Z" />
        </svg>
        <div
          ref={inner}
          className="popover-scroll"
          style={
            pos.maxHeight === null ? undefined : { maxHeight: pos.maxHeight, overflowY: "auto" }
          }
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
