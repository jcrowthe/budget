import { useCallback, useState } from "react";

/** The categories selected on the Plan page. `anchor` and `cursor` are the two ends of a Shift range. */
export type Selection = { ids: readonly string[]; anchor: string | null; cursor: string | null };

export const EMPTY: Selection = { ids: [], anchor: null, cursor: null };

export const selectOnly = (id: string): Selection => ({ ids: [id], anchor: id, cursor: id });

export function toggle(s: Selection, id: string): Selection {
  const ids = s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id];
  if (ids.length === 0) return EMPTY;
  return s.anchor === null ? { ids, anchor: id, cursor: id } : { ...s, ids };
}

/** Every id selected: remove them all; else add the missing ones. */
export function toggleMany(s: Selection, ids: readonly string[]): Selection {
  if (ids.length === 0) return s;
  if (ids.every((id) => s.ids.includes(id))) {
    const rest = s.ids.filter((x) => !ids.includes(x));
    return rest.length === 0 ? EMPTY : { ...s, ids: rest };
  }
  const next = [...s.ids, ...ids.filter((id) => !s.ids.includes(id))];
  return s.anchor === null
    ? { ids: next, anchor: ids[0] ?? null, cursor: ids[0] ?? null }
    : { ...s, ids: next };
}

export function selectAll(all: readonly string[], s: Selection = EMPTY): Selection {
  if (all.length === 0) return EMPTY;
  return {
    ids: [...all],
    anchor: s.anchor && all.includes(s.anchor) ? s.anchor : null,
    cursor: s.cursor && all.includes(s.cursor) ? s.cursor : null,
  };
}

/** Header checkbox: any selection clears; from empty, everything is selected. */
export function headerClick(s: Selection, all: readonly string[]): Selection {
  return s.ids.some((id) => all.includes(id)) ? EMPTY : selectAll(all);
}

/** ↓ (1) or ↑ (-1): one selected category, the next or previous in `order`, clamped at the ends. */
export function step(s: Selection, order: readonly string[], dir: 1 | -1): Selection {
  if (order.length === 0) return s;
  const last = [...s.ids].reverse().find((id) => order.includes(id)) ?? null;
  const from = s.cursor !== null && order.includes(s.cursor) ? s.cursor : last;
  if (from === null) return selectOnly((dir === 1 ? order[0] : order[order.length - 1]) as string);
  const i = order.indexOf(from) + dir;
  return selectOnly(order[Math.min(order.length - 1, Math.max(0, i))] as string);
}

/** Shift+↓ or Shift+↑: the range from the anchor to a cursor that moves by one. */
export function extend(s: Selection, order: readonly string[], dir: 1 | -1): Selection {
  const a = s.anchor === null ? -1 : order.indexOf(s.anchor);
  const c = s.cursor === null ? -1 : order.indexOf(s.cursor);
  if (a < 0 || c < 0) return step(s, order, dir);
  const to = Math.min(order.length - 1, Math.max(0, c + dir));
  const [lo, hi] = a < to ? [a, to] : [to, a];
  return { ids: order.slice(lo, hi + 1), anchor: s.anchor, cursor: order[to] as string };
}

/** The selected ids that are still among `all`, in `all` order. */
export function visibleSelection(s: Selection, all: readonly string[]): string[] {
  const set = new Set(s.ids);
  return all.filter((id) => set.has(id));
}

/** true when every id is selected, "mixed" when some are, false when none (or no ids). */
export function checkState(
  ids: readonly string[],
  selected: ReadonlySet<string>,
): boolean | "mixed" {
  const n = ids.filter((id) => selected.has(id)).length;
  if (n === 0) return false;
  return n === ids.length ? true : "mixed";
}

export function useSelection(): [Selection, (f: (s: Selection) => Selection) => void] {
  const [s, set] = useState<Selection>(EMPTY);
  return [s, useCallback((f) => set(f), [])];
}
