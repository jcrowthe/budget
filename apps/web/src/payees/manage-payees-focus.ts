import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const DEFAULT_RETURN = () => document.querySelector<HTMLElement>(".plan-button, .rail-logo");

/**
 * While mounted: Tab and Shift+Tab cycle inside `box`; Escape calls `onEscape`, which says whether it used the key.
 * The listener is on `window` in the capture phase, so the register's and the split dialog's document listeners never
 * see these keys. On unmount, focus goes to `returnTo()` (the plan button by default).
 */
export function useManagePayeesFocus(
  box: RefObject<HTMLElement | null>,
  opts: {
    onEscape: (e: KeyboardEvent) => boolean;
    returnTo?: () => HTMLElement | null;
    initial?: () => HTMLElement | null;
  },
): void {
  const esc = useRef(opts.onEscape);
  esc.current = opts.onEscape;
  const back = useRef(opts.returnTo ?? DEFAULT_RETURN);
  back.current = opts.returnTo ?? DEFAULT_RETURN;
  const first = useRef(opts.initial);
  first.current = opts.initial;
  useEffect(() => {
    const el = box.current;
    (first.current?.() ?? el?.querySelector<HTMLElement>(FOCUSABLE))?.focus({
      preventScroll: true,
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (esc.current(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === "Tab" && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (n) => n.offsetParent !== null || n === document.activeElement,
        );
        if (items.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? items[i <= 0 ? items.length - 1 : i - 1]
          : items[i === -1 || i === items.length - 1 ? 0 : i + 1];
        next?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const to = back.current();
      if (to?.isConnected) to.focus();
    };
  }, [box]);
}
