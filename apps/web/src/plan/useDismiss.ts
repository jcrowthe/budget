import { type RefObject, useEffect, useRef } from "react";

/** Closes a popover on Escape (focus goes back to the trigger) and on a mousedown outside it. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  returnFocus?: RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close.current();
      returnFocus?.current?.focus();
    };
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || returnFocus?.current?.contains(t)) return;
      close.current();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", down);
    };
  }, [ref, returnFocus]);
}
