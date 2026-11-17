import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const ARROW_W = 30;
const ARROW_H = 15;
const MARGIN = 8;

/**
 * A menu drawn on `document.body`, centred on its anchor (above or below it, with an arrow, flipping when there is
 * no room) or beside it. It closes on Escape and on a press outside it and its anchor.
 */
export function Popover({
  anchor,
  placement,
  width,
  label,
  role = "menu",
  className,
  bodyClass,
  dx = 4,
  belowTrim = 0,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  placement: "above" | "below" | "right";
  width: number;
  label: string;
  role?: "menu" | "dialog";
  /** Extra class of the popover (for example `is-submenu`) and of its body (`is-flags`). */
  className?: string;
  bodyClass?: string;
  /** For `right`: the gap from the anchor's right edge (negative overlaps it). */
  dx?: number;
  /** For `below`: pixels the menu moves up into the arrow's room, so the arrow overlaps the anchor more. */
  belowTrim?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGSVGElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const el = box.current;
      const tip = arrow.current;
      if (!el || !tip) return;
      const r = anchor.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - 2 * MARGIN);
      el.style.width = `${w}px`;
      const h = el.offsetHeight;
      if (placement === "right") {
        const fitsRight = r.right + dx + w <= window.innerWidth - MARGIN;
        el.style.left = `${fitsRight ? r.right + dx : Math.max(MARGIN, r.left - dx - w)}px`;
        el.style.top = `${Math.max(MARGIN, Math.min(r.top - 4, window.innerHeight - h - MARGIN))}px`;
        el.style.bottom = "auto";
        tip.style.display = "none";
        return;
      }
      const center = r.left + r.width / 2;
      const left = Math.max(MARGIN, Math.min(center - w / 2, window.innerWidth - w - MARGIN));
      el.style.left = `${left}px`;
      tip.style.left = `${Math.max(8, Math.min(center - left - ARROW_W / 2, w - ARROW_W - 8))}px`;
      const below = window.innerHeight - r.bottom - ARROW_H - MARGIN;
      const above = r.top - ARROW_H - MARGIN;
      const up = placement === "above" ? !(above < h && below > above) : below < h && above > below;
      tip.classList.toggle("is-down", up);
      if (up) {
        el.style.top = "auto";
        el.style.bottom = `${window.innerHeight - r.top + ARROW_H}px`;
      } else {
        el.style.bottom = "auto";
        el.style.top = `${r.bottom + ARROW_H - belowTrim}px`;
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.contains(t)) return;
      if ((t as HTMLElement).closest?.(".bulk-popover")) return;
      close.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [anchor]);

  return createPortal(
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a menu takes a label
    <div
      ref={box}
      className={`bulk-popover${className ? ` ${className}` : ""}`}
      role={role}
      aria-label={label}
    >
      <svg
        ref={arrow}
        className="bulk-popover-arrow"
        width={ARROW_W}
        height={ARROW_H}
        viewBox="0 0 30 15"
        aria-hidden="true"
      >
        <path d="M0 15 15 0 30 15Z" />
      </svg>
      <div className={`bulk-popover-body${bodyClass ? ` ${bodyClass}` : ""}`}>{children}</div>
    </div>,
    document.body,
  );
}
