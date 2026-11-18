import { type RefObject, useEffect, useRef } from "react";

let end: (() => void) | null = null;

/** After an outside press is used up, swallows the rest of that press (mouse, touch, right press) until the
 * next press or key. Ends with the press itself: no timer. */
function swallowRestOfPress(start: PointerEvent, focusTo: HTMLElement | null): void {
  end?.();
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const up = (e: Event) => {
    e.stopImmediatePropagation();
    if (focusTo?.isConnected && document.activeElement !== focusTo) focusTo.focus();
  };
  const next = (e: Event) => {
    if (e !== start) finish();
  };
  const finish = () => {
    for (const n of ["mousedown", "mouseup", "click", "auxclick", "contextmenu"])
      window.removeEventListener(n, stop, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointerdown", next, true);
    window.removeEventListener("keydown", finish, true);
    end = null;
  };
  for (const n of ["mousedown", "mouseup", "click", "auxclick", "contextmenu"])
    window.addEventListener(n, stop, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointerdown", next, true);
  window.addEventListener("keydown", finish, true);
  end = finish;
}

/** Closes a popover on Escape (focus goes back to the trigger) and on a press outside it. The press is
 * pointerdown: a disabled button gets no mousedown (EXF-727). With `consumeOutsidePress` (the Plan header's
 * picker and note, EXF-874), the outside press only closes. It never reaches what is under it (mouse, touch,
 * right press), and focus goes back to the trigger, as in the source. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  returnFocus?: RefObject<HTMLElement | null>,
  opts?: { consumeOutsidePress?: boolean },
) {
  const close = useRef(onClose);
  close.current = onClose;
  const consume = !!opts?.consumeOutsidePress;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close.current();
      returnFocus?.current?.focus();
    };
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || returnFocus?.current?.contains(t)) return;
      if (consume) {
        e.stopImmediatePropagation();
        close.current();
        swallowRestOfPress(e, returnFocus?.current ?? null);
        returnFocus?.current?.focus();
        return;
      }
      close.current();
    };
    document.addEventListener("keydown", key);
    if (consume) window.addEventListener("pointerdown", down, { capture: true });
    else document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("keydown", key);
      if (consume) window.removeEventListener("pointerdown", down, { capture: true });
      else document.removeEventListener("pointerdown", down);
    };
  }, [ref, returnFocus, consume]);
}
