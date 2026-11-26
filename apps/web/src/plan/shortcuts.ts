import { useEffect, useRef } from "react";

type Handlers = {
  onStep: (dir: 1 | -1) => void;
  onExtend: (dir: 1 | -1) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onCollapseAll: (collapsed: boolean) => void;
  onSnooze: () => void;
  /** Alt+Shift+Arrow: move the selected category one place. */
  onMove: (dir: 1 | -1) => void;
};

const IGNORED =
  "input, textarea, select, [contenteditable], [role=dialog], [role=menu], .target-form";

/**
 * The Plan page's keyboard shortcuts, bound on the window while the page is mounted: ↓ ↑ move the selection,
 * Shift+↓ Shift+↑ extend it, Ctrl or ⌘ + A selects all, Ctrl or ⌘ + ↑ ↓ collapse or expand every group, Escape
 * clears, Shift+Z snoozes the selected category's target, Alt+Shift+↓ ↑ moves the selected category one place. EXF-473 moves these bindings into the shortcut registry.
 */
export function usePlanShortcuts(h: Handlers): void {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as Element | null;
      if (t?.closest?.(IGNORED)) return;
      const mod = e.ctrlKey || e.metaKey;
      const arrow = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (e.altKey) {
        // Keyboard reorder (our addition): Alt+Shift+Arrow moves the selected category.
        if (!arrow || !e.shiftKey || mod) return;
        ref.current.onMove(arrow);
        e.preventDefault();
        return;
      }
      if (arrow && mod) {
        ref.current.onCollapseAll(arrow === -1);
      } else if (arrow && !mod) {
        if (e.shiftKey) ref.current.onExtend(arrow);
        else ref.current.onStep(arrow);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "a") {
        ref.current.onSelectAll();
      } else if (e.shiftKey && !mod && e.key.toLowerCase() === "z") {
        ref.current.onSnooze();
      } else if (e.key === "Escape" && !mod && !e.shiftKey) {
        ref.current.onClear();
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
