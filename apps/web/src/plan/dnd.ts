import type { MonthDetail } from "@budget/schema/months";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type CategoryMoveBody,
  type GroupMoveBody,
  withCategoryMoved,
  withGroupMoved,
} from "../api/categories";

// EXF-496: native HTML5 drag and drop of the Plan grid's category and group rows (docs/reorder-design.md).

type Groups = MonthDetail["groups"];
type Group = Groups[number];
type Category = Group["categories"][number];

export interface DragItem {
  kind: "category" | "group";
  id: string;
  /** The group a category is in. */
  groupId: string | null;
  /** A credit card payment category (stays in its group) or the Credit Card Payments group (pinned at the top). */
  payment: boolean;
}

/** `before`/`after`: a category row; `top`: right below a group's header. */
type CategoryGap = { before?: string; after?: string; top?: string };

/** Where the `drop-gap` row goes, and what the drop sends. */
export type Target =
  | { kind: "category"; body: CategoryMoveBody; gap: CategoryGap }
  | { kind: "group"; body: GroupMoveBody; gap: { before?: string; after?: string } };

/** True when the pointer is in the top half of the rect. */
export const inTopHalf = (pointerY: number, rect: { top: number; height: number }) =>
  pointerY < rect.top + rect.height / 2;

/** A payment category stays in its group; no other category may enter the Credit Card Payments group. */
export function allowed(item: DragItem, dest: { id: string; kind: string | null }): boolean {
  if (item.kind !== "category") return false;
  return item.payment ? dest.id === item.groupId : dest.kind === null;
}

const order = (groups: Groups) =>
  JSON.stringify(groups.map((g) => [g.id, g.categories.map((c) => c.id)]));

/**
 * What dropping a category on `target` (a row of `dest`) would do: top half → before it, bottom half → after it;
 * no `target` (the group's header) → first in the group. Null when the server would refuse, or nothing changes.
 */
export function categoryPlacement(
  item: DragItem,
  groups: Groups,
  dest: Group,
  target: Category | null,
  pointerY: number,
  rect: { top: number; height: number },
): Target | null {
  if (item.kind !== "category" || !allowed(item, dest)) return null;
  let body: CategoryMoveBody;
  let gap: CategoryGap;
  if (target) {
    if (target.id === item.id) return null;
    const top = inTopHalf(pointerY, rect);
    body = top
      ? { group_id: dest.id, before_category_id: target.id }
      : { group_id: dest.id, after_category_id: target.id };
    gap = top ? { before: target.id } : { after: target.id };
  } else {
    const first = dest.categories.find((c) => c.id !== item.id);
    body = first ? { group_id: dest.id, before_category_id: first.id } : { group_id: dest.id };
    gap = { top: dest.id };
  }
  const after = withCategoryMoved(groups, item.id, dest.id, body);
  if (order(after) === order(groups)) return null;
  return { kind: "category", body, gap };
}

/**
 * What dropping a group on another group's block would do: top half → before it, bottom half → after it
 * ("below the last category" is after the group). The Credit Card Payments group is pinned first by the plan, so
 * it can't be dragged and nothing can be placed above it.
 */
export function groupPlacement(
  item: DragItem,
  groups: Groups,
  over: Group,
  pointerY: number,
  blockRect: { top: number; height: number },
): Target | null {
  if (item.kind !== "group" || item.payment || over.id === item.id) return null;
  const top = inTopHalf(pointerY, blockRect);
  if (top && over.kind !== null) return null;
  const body: GroupMoveBody = top ? { before_group_id: over.id } : { after_group_id: over.id };
  const same =
    withGroupMoved(groups, item.id, body)
      .map((g) => g.id)
      .join() === groups.map((g) => g.id).join();
  if (same) return null;
  return { kind: "group", body, gap: top ? { before: over.id } : { after: over.id } };
}

/** A drag that starts in an editor (or the Assigned cell) is not a row drag. */
const NOT_A_HANDLE = "input, textarea, [contenteditable], .cell-assigned";

export interface RowDragProps {
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

interface State {
  item: DragItem;
  target: Target | null;
}

export function usePlanDnd({
  groups,
  onMoveCategory,
  onMoveGroup,
}: {
  groups: Groups;
  onMoveCategory: (id: string, body: CategoryMoveBody) => void;
  onMoveGroup: (id: string, body: GroupMoveBody) => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const ref = useRef<State | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const handlers = useRef({ onMoveCategory, onMoveGroup });
  handlers.current = { onMoveCategory, onMoveGroup };

  const set = useCallback((next: State | null) => {
    ref.current = next;
    setState(next);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const end = useCallback(() => {
    clearTimeout(timer.current);
    set(null);
  }, [set]);

  const start = (item: DragItem) => (e: DragEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest(NOT_A_HANDLE)) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
    ref.current = { item, target: null };
    // Dim the row after the browser has taken its drag image.
    timer.current = setTimeout(() => setState(ref.current), 0);
  };

  /** Records the target the pointer is over (null: no gap), and allows the drop only on a target. */
  const over = (e: DragEvent<HTMLElement>, target: Target | null) => {
    const cur = ref.current;
    if (!cur) return;
    if (target) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
    if (JSON.stringify(cur.target) !== JSON.stringify(target)) set({ item: cur.item, target });
  };

  const drop = (e: DragEvent<HTMLElement>) => {
    const cur = ref.current;
    if (!cur) return;
    e.preventDefault();
    e.stopPropagation();
    const t = cur.target;
    end();
    if (!t) return;
    if (t.kind === "category") handlers.current.onMoveCategory(cur.item.id, t.body);
    else handlers.current.onMoveGroup(cur.item.id, t.body);
  };

  const rect = (e: DragEvent<HTMLElement>) => e.currentTarget.getBoundingClientRect();

  return {
    /** The dragged row's id, once the drag has started. */
    draggingId: state?.item.id ?? null,
    /** Where the gap row goes, or null. */
    target: state?.target ?? null,
    groupRow(g: Group): RowDragProps {
      return {
        draggable: g.kind === null,
        onDragStart:
          g.kind === null
            ? start({ kind: "group", id: g.id, groupId: null, payment: false })
            : () => {},
        onDragOver: (e) => {
          const cur = ref.current;
          if (cur?.item.kind !== "category") return;
          e.stopPropagation();
          over(e, categoryPlacement(cur.item, groupsRef.current, g, null, e.clientY, rect(e)));
        },
        onDrop: drop,
        onDragEnd: end,
      };
    },
    categoryRow(c: Category, g: Group): RowDragProps {
      return {
        draggable: true,
        onDragStart: start({ kind: "category", id: c.id, groupId: g.id, payment: c.kind !== null }),
        onDragOver: (e) => {
          const cur = ref.current;
          if (cur?.item.kind !== "category") return;
          e.stopPropagation();
          over(e, categoryPlacement(cur.item, groupsRef.current, g, c, e.clientY, rect(e)));
        },
        onDrop: drop,
        onDragEnd: end,
      };
    },
    /** The block of a group and its categories: where a dragged group is placed. */
    groupBlock(g: Group) {
      return {
        onDragOver: (e: DragEvent<HTMLElement>) => {
          const cur = ref.current;
          if (!cur) return;
          if (cur.item.kind === "group") {
            over(e, groupPlacement(cur.item, groupsRef.current, g, e.clientY, rect(e)));
          } else if ((e.target as HTMLElement).closest(".drop-gap") && cur.target) {
            // Over the gap itself: keep it, and allow the drop.
            e.preventDefault();
          }
        },
        onDrop: drop,
      };
    },
    /** The gap row: the pointer over it keeps the drop where it is. */
    gap: {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (ref.current?.target) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      },
      onDrop: drop,
    },
  };
}
