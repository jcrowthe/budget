import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampWidth,
  isNarrow,
  KEY_COLLAPSED,
  KEY_WIDTH,
  readSidebarState,
  releaseWidth,
  SIDEBAR_COLLAPSED,
  type SidebarSaved,
  SNAP_AT,
} from "./sidebarState";

function save(s: SidebarSaved) {
  try {
    localStorage.setItem(KEY_COLLAPSED, String(s.collapsed));
    localStorage.setItem(KEY_WIDTH, String(s.preferred));
  } catch {
    // Storage may be unavailable; the state then lasts for this page only.
  }
}

/** The sidebar's collapsed state and width. Read synchronously, so the first paint already has them. */
export function useSidebarState() {
  const [saved, setSaved] = useState<SidebarSaved>(() =>
    readSidebarState((k) => localStorage.getItem(k)),
  );
  const [live, setLive] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopDrag = useRef<(() => void) | null>(null);
  const width = live ?? (saved.collapsed ? SIDEBAR_COLLAPSED : saved.preferred);

  const endTransition = useCallback(() => {
    clearTimeout(fallback.current);
    setTransitioning(false);
  }, []);

  const toggle = useCallback(() => {
    setSaved((s) => {
      const next = { ...s, collapsed: !s.collapsed };
      save(next);
      return next;
    });
    setTransitioning(true);
    clearTimeout(fallback.current);
    fallback.current = setTimeout(endTransition, 300);
  }, [endTransition]);

  const onResizerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      let current = startWidth;
      endTransition();
      document.documentElement.classList.add("sidebar-resizing");
      const move = (ev: MouseEvent) => {
        current = clampWidth(startWidth + ev.clientX - startX);
        setLive(current);
      };
      const end = () => {
        cleanup();
        const next = releaseWidth(current);
        save(next);
        setSaved(next);
        setLive(null);
      };
      const cleanup = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", end);
        document.documentElement.removeEventListener("mouseleave", end);
        window.removeEventListener("blur", end);
        document.documentElement.classList.remove("sidebar-resizing");
        stopDrag.current = null;
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", end);
      document.documentElement.addEventListener("mouseleave", end);
      window.addEventListener("blur", end);
      stopDrag.current = cleanup;
    },
    [width, endTransition],
  );

  useEffect(
    () => () => {
      stopDrag.current?.();
      clearTimeout(fallback.current);
    },
    [],
  );

  return {
    collapsed: saved.collapsed,
    width,
    showRail: live !== null ? live <= SNAP_AT : saved.collapsed,
    narrow: isNarrow(width),
    dragging: live !== null,
    transitioning,
    toggle,
    onResizerMouseDown,
    endTransition,
  };
}
