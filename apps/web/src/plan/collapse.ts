// Collapse state of category groups: the read model's `collapsed`, saved on the server (PATCH
// /category_groups/{id} {collapsed}) and shown at once from the cached months.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { setGroupsCollapsed } from "../api/categories";

export function useCollapsedGroups(
  budgetId: string,
  groups: { id: string; collapsed: boolean }[] | undefined,
) {
  const qc = useQueryClient();
  const isCollapsed = (id: string) => groups?.find((g) => g.id === id)?.collapsed ?? false;
  // Only the groups whose value differs are sent.
  const current = new Map((groups ?? []).map((g) => [g.id, g.collapsed]));
  const key = [...current].join(";");
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for current
  const setCollapsed = useCallback(
    (ids: string[], collapsed: boolean) => {
      void setGroupsCollapsed(
        qc,
        budgetId,
        ids.filter((id) => current.get(id) !== collapsed),
        collapsed,
      );
    },
    [qc, budgetId, key],
  );
  return { isCollapsed, setCollapsed };
}
