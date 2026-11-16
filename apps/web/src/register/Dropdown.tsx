import { type ReactNode, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const GAP = 2;
const MARGIN = 8;

/**
 * A list or calendar anchored to a field, drawn on `document.body` so no table or scroll box can clip it.
 * Below the anchor, or above it when there is no room; as tall as the room allows; placed again on scroll
 * and resize.
 */
export function Dropdown({
  anchor,
  label,
  minWidth,
  role = "listbox",
  children,
  footer,
}: {
  anchor: HTMLElement;
  label: string;
  minWidth: number;
  role?: "listbox" | "dialog";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // Runs after every render: the content (and so the height) changes as the user types.
  useLayoutEffect(() => {
    const place = () => {
      const el = box.current;
      const inner = body.current;
      if (!el || !inner) return;
      const r = anchor.getBoundingClientRect();
      el.style.left = `${Math.max(MARGIN, Math.min(r.left, window.innerWidth - minWidth - MARGIN))}px`;
      el.style.minWidth = `${Math.max(minWidth, r.width)}px`;
      inner.style.maxHeight = "none";
      const natural = el.offsetHeight;
      const below = window.innerHeight - r.bottom - MARGIN;
      const above = r.top - MARGIN;
      const flip = below < Math.min(natural, 240) + MARGIN && above > below;
      const room = flip ? above : below;
      const chrome = natural - inner.offsetHeight;
      inner.style.maxHeight = `${Math.max(80, room - chrome - GAP)}px`;
      if (flip) {
        el.style.top = "auto";
        el.style.bottom = `${window.innerHeight - r.top + GAP}px`;
      } else {
        el.style.bottom = "auto";
        el.style.top = `${r.bottom + GAP}px`;
      }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  });

  return createPortal(
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is a listbox or a dialog, both take a label
    <div ref={box} className="entry-dropdown" role={role} aria-label={label} tabIndex={-1}>
      <div ref={body} className="entry-dropdown-body">
        {children}
      </div>
      {footer ? <div className="entry-dropdown-footer">{footer}</div> : null}
    </div>,
    document.body,
  );
}
