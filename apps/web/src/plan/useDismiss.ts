import { type RefObject, useEffect, useRef } from "react";

/** Closes a popover on Escape (focus goes back to the trigger) and on a press outside it. The press is
 * pointerdown: a disabled button gets no mousedown (EXF-727). */
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
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || returnFocus?.current?.contains(t)) return;
      close.current();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
    };
  }, [ref, returnFocus]);
}
