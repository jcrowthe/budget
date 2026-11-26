import { useEffect, useRef } from "react";

type Keys = {
  /** Something is selected: the letter keys and Escape act. */
  hasSelection: boolean;
  /** An entry row is open: no key acts. */
  entryOpen: boolean;
  selectAll: () => void;
  clearSelection: () => void;
  /** Each is undefined when its button is not shown. */
  clear?: () => void;
  categorize?: () => void;
  approve?: () => void;
  reject?: () => void;
  duplicate?: () => void;
  makeRepeating?: () => void;
  flag?: () => void;
  del?: () => void;
  /** Enter Now, for a selection of scheduled rows. */
  enterNow?: () => void;
};

const inField = (t: EventTarget | null) => {
  const el = t instanceof HTMLElement ? t : null;
  return (
    !!el && (el.closest("input,textarea,select,[contenteditable]") !== null || el.isContentEditable)
  );
};

/** The register's keys: one listener, acting only when focus is not in a field and no menu, dialog or entry row is open. */
export function useRegisterKeys(keys: Keys) {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = ref.current;
      if (e.defaultPrevented || e.altKey || k.entryOpen || inField(e.target)) return;
      if (document.querySelector('[aria-modal="true"],[role="menu"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod) {
        if (key === "a" && !e.shiftKey) {
          e.preventDefault();
          k.selectAll();
        }
        return;
      }
      if (!k.hasSelection) return;
      let act: (() => void) | undefined;
      if (e.key === "Escape") act = k.clearSelection;
      else if (e.key === "Delete" || e.key === "Backspace") act = k.del;
      else if (!e.shiftKey && key === "e") act = k.enterNow;
      else if (!e.shiftKey && key === "c") act = k.clear;
      else if (!e.shiftKey && key === "k") act = k.categorize;
      else if (!e.shiftKey && key === "a") act = k.approve;
      else if (e.shiftKey && key === "r") act = k.reject;
      else if (e.shiftKey && key === "d") act = k.duplicate;
      else if (e.shiftKey && key === "t") act = k.makeRepeating;
      else if (e.shiftKey && key === "f") act = k.flag;
      if (!act) return;
      e.preventDefault();
      act();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
