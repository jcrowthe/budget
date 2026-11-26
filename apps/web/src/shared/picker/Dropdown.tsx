import { type ReactNode, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./picker.css";

const ARROW_W = 30;
const ARROW_H = 15;
const MARGIN = 8;
const LIST_MAX = 210;

/**
 * A list or calendar anchored to a field, drawn on `document.body` so no table or scroll box can clip it.
 * Centred under the anchor with an arrow (like the Plan's popovers), 15px below it; above it, arrow down,
 * when there is no room; as tall as the room allows; placed again on scroll and resize.
 */
export function Dropdown({
  anchor,
  id,
  label,
  width,
  role = "listbox",
  children,
  header,
  footer,
}: {
  anchor: HTMLElement;
  id?: string;
  label: string;
  width: number;
  role?: "listbox" | "dialog";
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGSVGElement>(null);

  // Runs after every render: the content (and so the height) changes as the user types.
  useLayoutEffect(() => {
    const place = () => {
      const el = box.current;
      const inner = body.current;
      const tip = arrow.current;
      if (!el || !inner || !tip) return;
      const r = anchor.getBoundingClientRect();
      const w = Math.min(width, window.innerWidth - 2 * MARGIN);
      const center = r.left + r.width / 2;
      const left = Math.max(MARGIN, Math.min(center - w / 2, window.innerWidth - w - MARGIN));
      el.style.width = `${w}px`;
      el.style.left = `${left}px`;
      tip.style.left = `${Math.max(8, Math.min(center - left - ARROW_W / 2, w - ARROW_W - 8))}px`;
      // Lifting the cap to measure would reset the list's scroll: put it back after.
      const scrolled = inner.scrollTop;
      inner.style.maxHeight = "none";
      const natural = el.offsetHeight;
      const below = window.innerHeight - r.bottom - ARROW_H - MARGIN;
      const above = r.top - ARROW_H - MARGIN;
      const flip = below < Math.min(natural, 240) && above > below;
      const room = flip ? above : below;
      const chrome = natural - inner.offsetHeight;
      const cap = role === "listbox" ? LIST_MAX : Number.POSITIVE_INFINITY;
      inner.style.maxHeight = `${Math.max(80, Math.min(cap, room - chrome))}px`;
      inner.scrollTop = scrolled;
      tip.classList.toggle("is-down", flip);
      if (flip) {
        el.style.top = "auto";
        el.style.bottom = `${window.innerHeight - r.top + ARROW_H}px`;
      } else {
        el.style.bottom = "auto";
        el.style.top = `${r.bottom + ARROW_H}px`;
      }
    };
    place();
    // The list's own scrolling must not re-place it: that lifts the height cap for a moment and resets the scroll.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && box.current?.contains(e.target)) return;
      place();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  });

  return createPortal(
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is a listbox or a dialog, both take a label
    <div ref={box} id={id} className="entry-dropdown" role={role} aria-label={label} tabIndex={-1}>
      <svg
        ref={arrow}
        className="entry-arrow"
        width={ARROW_W}
        height={ARROW_H}
        viewBox="0 0 30 15"
        aria-hidden="true"
      >
        <path d="M0 15 15 0 30 15Z" />
      </svg>
      <div className="entry-dropdown-panel">
        {header ? <div className="entry-dropdown-header">{header}</div> : null}
        <div ref={body} className="entry-dropdown-body">
          {children}
        </div>
        {footer ? <div className="entry-dropdown-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
