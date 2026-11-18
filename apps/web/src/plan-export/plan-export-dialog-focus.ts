import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** While mounted: Tab / Shift+Tab cycle through the focusable elements inside `box` (capture phase);
 *  Escape calls onEscape. On unmount focuses `returnTo()` if connected. */
export function useDialogFocus(
  box: RefObject<HTMLElement | null>,
  opts: {
    onEscape: () => void;
    returnTo: () => HTMLElement | null;
    initial?: RefObject<HTMLElement | null>;
  },
): void {
  const esc = useRef(opts.onEscape);
  esc.current = opts.onEscape;
  const back = useRef(opts.returnTo);
  back.current = opts.returnTo;
  const initial = opts.initial;
  useEffect(() => {
    const el = box.current;
    (initial?.current ?? el?.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        esc.current();
      } else if (e.key === "Tab" && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (n) => n.offsetParent !== null || n === document.activeElement,
        );
        if (items.length === 0) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? items[i <= 0 ? items.length - 1 : i - 1]
          : items[i === -1 || i === items.length - 1 ? 0 : i + 1];
        next?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const to = back.current();
      if (to?.isConnected) to.focus();
    };
  }, [box, initial]);
}
