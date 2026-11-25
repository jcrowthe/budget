import type { DisplayGroup, SidebarSection } from "@budget/core/account-types";
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { inTopHalf } from "../plan/dnd";

// EXF-490: native HTML5 drag and drop of the sidebar's account rows (docs/account-reorder-design.md). An
// account reorders only within its section, so a drop anywhere else offers no gap and sends nothing.

export interface DragItem {
  id: string;
  section: SidebarSection;
  /** The account's type group; STARRED mixes groups but only reorders within one. */
  group: DisplayGroup;
}

export interface SidebarRow {
  id: string;
  group: DisplayGroup;
}

/** The row the gap goes before or after. */
export type Gap = { before: string } | { after: string };

export interface Placement {
  /** The accounts to send, in their new order (STARRED: the starred ones of the dragged account's group). */
  ids: string[];
  gap: Gap;
}

/**
 * What dropping `item` on `target` (a row of `section`) would do: top half → before it, bottom half → after it.
 * Null in another section, in STARRED on another type group, on itself, or when the order would not change.
 */
export function sidebarPlacement(
  item: DragItem,
  section: SidebarSection,
  rows: readonly SidebarRow[],
  target: SidebarRow,
  pointerY: number,
  rect: { top: number; height: number },
): Placement | null {
  if (section === "closed" || item.section !== section || target.id === item.id) return null;
  if (section === "starred" && target.group !== item.group) return null;
  const scope = (section === "starred" ? rows.filter((r) => r.group === item.group) : rows).map(
    (r) => r.id,
  );
  if (!scope.includes(item.id) || !scope.includes(target.id)) return null;
  const top = inTopHalf(pointerY, rect);
  const rest = scope.filter((id) => id !== item.id);
  const at = rest.indexOf(target.id) + (top ? 0 : 1);
  const ids = [...rest.slice(0, at), item.id, ...rest.slice(at)];
  if (ids.join() === scope.join()) return null;
  return { ids, gap: top ? { before: target.id } : { after: target.id } };
}

/**
 * Keyboard reorder (our addition; the source app has none): Alt+Shift+ArrowUp/ArrowDown moves the account one place
 * within its section (STARRED: within its type group). Null at either end and in Closed. `name` is for the announcement.
 */
export function sidebarKeyboardMove(
  section: SidebarSection,
  rows: readonly (SidebarRow & { name: string })[],
  id: string,
  dir: -1 | 1,
): { ids: string[]; text: string } | null {
  if (section === "closed") return null;
  const me = rows.find((r) => r.id === id);
  if (!me) return null;
  const scope = section === "starred" ? rows.filter((r) => r.group === me.group) : [...rows];
  const i = scope.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= scope.length) return null;
  const a = scope[i];
  const b = scope[j];
  if (!a || !b) return null;
  const next = [...scope];
  next[i] = b;
  next[j] = a;
  return {
    ids: next.map((r) => r.id),
    text: `Moved ${me.name} to position ${j + 1} of ${scope.length}.`,
  };
}

export interface RowDragProps {
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

interface State {
  item: DragItem;
  section: SidebarSection | null;
  placement: Placement | null;
}

export function useSidebarDnd({ onReorder }: { onReorder: (ids: string[]) => void }) {
  const [state, setState] = useState<State | null>(null);
  const ref = useRef<State | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handler = useRef(onReorder);
  handler.current = onReorder;

  const set = useCallback((next: State | null) => {
    ref.current = next;
    setState(next);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const [announcement, setAnnouncement] = useState("");
  const refocus = useRef<{ id: string; at: number } | null>(null);

  const end = useCallback(() => {
    clearTimeout(timer.current);
    set(null);
  }, [set]);

  const drop = (e: DragEvent<HTMLElement>) => {
    const cur = ref.current;
    if (!cur) return;
    e.preventDefault();
    e.stopPropagation();
    const p = cur.placement;
    end();
    if (p) handler.current(p.ids);
  };

  return {
    /** The text of the last keyboard move, for an aria-live region. */
    announcement,
    /** An id to focus once the list has re-rendered (the moved account's link), read by the sidebar. */
    takeRefocus() {
      const r = refocus.current;
      refocus.current = null;
      return r && Date.now() - r.at < 3000 ? r.id : null;
    },
    /** The dragged row, once the drag has started. */
    dragging: state?.item ?? null,
    /** The section the gap is in and where, or null. */
    gap:
      state?.placement && state.section
        ? { section: state.section, at: state.placement.gap }
        : null,
    row(
      a: SidebarRow & { name?: string },
      section: SidebarSection,
      rows: readonly (SidebarRow & { name?: string })[],
    ): RowDragProps {
      return {
        draggable: section !== "closed",
        onKeyDown: (e) => {
          if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          e.stopPropagation();
          const m = sidebarKeyboardMove(
            section,
            rows.map((r) => ({ ...r, name: r.name ?? "" })),
            a.id,
            e.key === "ArrowUp" ? -1 : 1,
          );
          if (!m) return;
          setAnnouncement(m.text);
          refocus.current = { id: a.id, at: Date.now() };
          handler.current(m.ids);
        },
        onDragStart: (e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", a.id);
          ref.current = {
            item: { id: a.id, section, group: a.group },
            section: null,
            placement: null,
          };
          // Dim the row after the browser has taken its drag image.
          timer.current = setTimeout(() => setState(ref.current), 0);
        },
        onDragOver: (e) => {
          const cur = ref.current;
          if (!cur) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const placement = sidebarPlacement(cur.item, section, rows, a, e.clientY, rect);
          if (placement) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
          const same =
            cur.section === (placement ? section : null) &&
            JSON.stringify(cur.placement) === JSON.stringify(placement);
          if (!same) set({ item: cur.item, section: placement ? section : null, placement });
        },
        onDrop: drop,
        onDragEnd: end,
      };
    },
    /** The gap element: the pointer over it keeps the drop where it is. */
    gapProps: {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (ref.current?.placement) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      },
      onDrop: drop,
    },
  };
}
