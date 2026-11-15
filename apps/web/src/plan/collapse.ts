// Collapse state of category groups. It lives in the browser (localStorage, one key per plan) until EXF-494 adds
// the category-group routes: THEN `saveCollapsed` becomes a PATCH /category_groups/{gid} {collapsed} per change and
// `loadCollapsed` drops the overlay, leaving the read model's `collapsed` as the only source.
import { useCallback, useState } from "react";

const key = (budgetId: string) => `budget.planGrid.collapsed.${budgetId}`;

function readStored(budgetId: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(budgetId)) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter((e): e is [string, boolean] => typeof e[1] === "boolean"),
      );
    }
  } catch {
    // Bad JSON or storage unavailable: no saved state.
  }
  return {};
}

/** The saved value of each group, falling back to the read model's `collapsed`. */
export function loadCollapsed(
  budgetId: string,
  groups: { id: string; collapsed: boolean }[],
): Record<string, boolean> {
  const saved = readStored(budgetId);
  return Object.fromEntries(groups.map((g) => [g.id, saved[g.id] ?? g.collapsed]));
}

/** Merges the changes into the stored state. EXF-494 swaps this function for the server PATCH. */
export function saveCollapsed(budgetId: string, changes: Record<string, boolean>): void {
  try {
    localStorage.setItem(key(budgetId), JSON.stringify({ ...readStored(budgetId), ...changes }));
  } catch {
    // Storage can throw (private mode, quota): the collapse then lasts until reload.
  }
}

export function useCollapsedGroups(
  budgetId: string,
  groups: { id: string; collapsed: boolean }[] | undefined,
) {
  // Changes made in this session, over what loadCollapsed returns (re-read each render: it is cheap).
  const [local, setLocal] = useState<{ budgetId: string; changes: Record<string, boolean> }>({
    budgetId,
    changes: {},
  });
  const changes = local.budgetId === budgetId ? local.changes : {};
  const base = loadCollapsed(budgetId, groups ?? []);
  const isCollapsed = useCallback(
    (id: string) => changes[id] ?? base[id] ?? false,
    [changes, base],
  );
  const setCollapsed = useCallback(
    (ids: string[], collapsed: boolean) => {
      const next = Object.fromEntries(ids.map((id) => [id, collapsed]));
      setLocal((l) => ({
        budgetId,
        changes: { ...(l.budgetId === budgetId ? l.changes : {}), ...next },
      }));
      saveCollapsed(budgetId, next);
    },
    [budgetId],
  );
  return { isCollapsed, setCollapsed };
}
