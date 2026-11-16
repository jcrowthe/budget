import { useEffect, useRef } from "react";

type Handlers = {
  onStep: (dir: 1 | -1) => void;
  onExtend: (dir: 1 | -1) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onCollapseAll: (collapsed: boolean) => void;
};

const IGNORED =
  "input, textarea, select, [contenteditable], [role=dialog], [role=menu], .target-form";

/**
 * The Plan page's keyboard shortcuts, bound on the window while the page is mounted: ↓ ↑ move the selection,
 * Shift+↓ Shift+↑ extend it, Ctrl or ⌘ + A selects all, Ctrl or ⌘ + ↑ ↓ collapse or expand every group, Escape
 * clears. EXF-473 moves these bindings into the shortcut registry.
 */
export function usePlanShortcuts(h: Handlers): void {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const t = e.target as Element | null;
      if (t?.closest?.(IGNORED)) return;
      const mod = e.ctrlKey || e.metaKey;
      const arrow = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (arrow && mod) {
        ref.current.onCollapseAll(arrow === -1);
      } else if (arrow && !mod) {
        if (e.shiftKey) ref.current.onExtend(arrow);
        else ref.current.onStep(arrow);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "a") {
        ref.current.onSelectAll();
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
