import {
  CategoriesUnhiddenResponse,
  CategoryDeletedResponse,
  CategoryGroupResponse,
  CategoryResponse,
  CategoryUsageResponse,
} from "@budget/schema/categories";
import type { MonthDetail } from "@budget/schema/months";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { recordPlan } from "./assigned";
import { apiFetch } from "./client";
import { beginWrite, endWrite, inOrder } from "./monthCache";

const base = (b: string) => `/api/v1/budgets/${b}` as const;
const write = { idempotencyKey: undefined as string | undefined };
const key = () => ({ ...write, idempotencyKey: crypto.randomUUID() });
type OnChangeSet = (id: string) => void;
const reassign = (to?: string) => (to ? `?reassign_to=${encodeURIComponent(to)}` : "");

export const createGroup = async (b: string, name: string, onChangeSet?: OnChangeSet) =>
  (
    await apiFetch(`${base(b)}/category_groups`, {
      method: "POST",
      body: { name },
      schema: CategoryGroupResponse,
      onChangeSet,
      ...key(),
    })
  ).data.category_group;

export const createCategory = async (
  b: string,
  groupId: string,
  name: string,
  onChangeSet?: OnChangeSet,
) =>
  (
    await apiFetch(`${base(b)}/categories`, {
      method: "POST",
      body: { group_id: groupId, name },
      schema: CategoryResponse,
      onChangeSet,
      ...key(),
    })
  ).data.category;

export interface CategoryMoveBody {
  group_id: string;
  before_category_id?: string;
  after_category_id?: string;
}
export interface GroupMoveBody {
  before_group_id?: string;
  after_group_id?: string;
}

export const moveCategory = async (
  b: string,
  id: string,
  body: CategoryMoveBody,
  onChangeSet?: OnChangeSet,
) =>
  (
    await apiFetch(`${base(b)}/categories/${id}/move`, {
      method: "POST",
      body,
      schema: CategoryResponse,
      onChangeSet,
      ...key(),
    })
  ).data.category;

export const moveGroup = async (
  b: string,
  id: string,
  body: GroupMoveBody,
  onChangeSet?: OnChangeSet,
) =>
  (
    await apiFetch(`${base(b)}/category_groups/${id}/move`, {
      method: "POST",
      body,
      schema: CategoryGroupResponse,
      onChangeSet,
      ...key(),
    })
  ).data.category_group;

/** Pure: the groups with the category moved into `groupId`, before/after a sibling (neither: last). */
export function withCategoryMoved(
  groups: MonthDetail["groups"],
  id: string,
  groupId: string,
  body: Pick<CategoryMoveBody, "before_category_id" | "after_category_id">,
): MonthDetail["groups"] {
  const moved = groups.flatMap((g) => g.categories).find((c) => c.id === id);
  if (!moved) return groups;
  return groups.map((g) => {
    const rest = g.categories.filter((c) => c.id !== id);
    if (g.id !== groupId) return { ...g, categories: rest };
    const ref = body.before_category_id ?? body.after_category_id;
    const at = ref ? rest.findIndex((c) => c.id === ref) : -1;
    const i = at < 0 ? rest.length : body.before_category_id ? at : at + 1;
    return { ...g, categories: [...rest.slice(0, i), moved, ...rest.slice(i)] };
  });
}

/** Pure: the groups with one moved before/after another (neither: last). */
export function withGroupMoved(
  groups: MonthDetail["groups"],
  id: string,
  body: GroupMoveBody,
): MonthDetail["groups"] {
  const moved = groups.find((g) => g.id === id);
  if (!moved) return groups;
  const rest = groups.filter((g) => g.id !== id);
  const ref = body.before_group_id ?? body.after_group_id;
  const at = ref ? rest.findIndex((g) => g.id === ref) : -1;
  const i = at < 0 ? rest.length : body.before_group_id ? at : at + 1;
  return [...rest.slice(0, i), moved, ...rest.slice(i)];
}

function patchGroups(
  qc: QueryClient,
  budgetId: string,
  fn: (g: MonthDetail["groups"]) => MonthDetail["groups"],
) {
  qc.setQueriesData<MonthDetail>({ queryKey: ["month", budgetId] }, (d) =>
    d ? { ...d, groups: fn(d.groups) } : d,
  );
}

export const updateGroup = async (
  b: string,
  id: string,
  patch: { name?: string; hidden?: boolean; collapsed?: boolean },
  onChangeSet?: OnChangeSet,
) =>
  (
    await apiFetch(`${base(b)}/category_groups/${id}`, {
      method: "PATCH",
      body: patch,
      schema: CategoryGroupResponse,
      onChangeSet,
      ...key(),
    })
  ).data.category_group;

export const updateCategory = async (
  b: string,
  id: string,
  patch: { name?: string; hidden?: boolean },
  onChangeSet?: OnChangeSet,
) =>
  (
    await apiFetch(`${base(b)}/categories/${id}`, {
      method: "PATCH",
      body: patch,
      schema: CategoryResponse,
      onChangeSet,
      ...key(),
    })
  ).data.category;

export const setCategoryNote = async (b: string, id: string, note: string | null) =>
  (
    await apiFetch(`${base(b)}/categories/${id}`, {
      method: "PATCH",
      body: { note },
      schema: CategoryResponse,
      ...key(),
    })
  ).data.category;

export const groupUsage = async (b: string, id: string) =>
  (await apiFetch(`${base(b)}/category_groups/${id}/usage`, { schema: CategoryUsageResponse })).data
    .usage;

export const categoryUsage = async (b: string, id: string) =>
  (await apiFetch(`${base(b)}/categories/${id}/usage`, { schema: CategoryUsageResponse })).data
    .usage;

export const deleteGroup = async (
  b: string,
  id: string,
  reassignTo?: string,
  onChangeSet?: OnChangeSet,
) =>
  (
    await apiFetch(`${base(b)}/category_groups/${id}${reassign(reassignTo)}`, {
      method: "DELETE",
      schema: CategoryDeletedResponse,
      onChangeSet,
      ...key(),
    })
  ).data.deleted;

export const deleteCategory = async (
  b: string,
  id: string,
  reassignTo?: string,
  onChangeSet?: OnChangeSet,
) =>
  (
    await apiFetch(`${base(b)}/categories/${id}${reassign(reassignTo)}`, {
      method: "DELETE",
      schema: CategoryDeletedResponse,
      onChangeSet,
      ...key(),
    })
  ).data.deleted;

export const unhideAll = async (b: string, onChangeSet?: OnChangeSet) =>
  (
    await apiFetch(`${base(b)}/categories/unhide_all`, {
      method: "POST",
      schema: CategoriesUnhiddenResponse,
      onChangeSet,
      ...key(),
    })
  ).data.unhidden;

/** The writes of the grid, each refetching the plan's months when it succeeds and put on the Undo stack. */
export function useCategoryActions(budgetId: string) {
  const qc = useQueryClient();
  return useMemo(() => {
    const done = async <R>(run: () => Promise<R>): Promise<R> => {
      await beginWrite(qc, budgetId);
      try {
        return await run();
      } finally {
        endWrite(qc, budgetId);
      }
    };
    // Category, group and plan-wide writes are not bound to a month: their undo stays on the shown month.
    const rec = (...categoryIds: string[]) => recordPlan(budgetId, { month: null, categoryIds });
    return {
      createGroup: (name: string) => done(() => createGroup(budgetId, name, rec())),
      createCategory: (groupId: string, name: string) =>
        done(() => createCategory(budgetId, groupId, name, rec())),
      updateGroup: (id: string, patch: Parameters<typeof updateGroup>[2]) =>
        // A patch of only `collapsed` is UI state with no change_log row: never recorded.
        done(() =>
          updateGroup(
            budgetId,
            id,
            patch,
            Object.keys(patch).every((k) => k === "collapsed") ? undefined : rec(),
          ),
        ),
      updateCategory: (id: string, patch: Parameters<typeof updateCategory>[2]) =>
        done(() => updateCategory(budgetId, id, patch, rec(id))),
      // The cached months change at once (every month shows one order); the refetch brings the subtotals.
      moveCategory: (id: string, body: CategoryMoveBody) =>
        done(() => {
          patchGroups(qc, budgetId, (g) => withCategoryMoved(g, id, body.group_id, body));
          return moveCategory(budgetId, id, body, rec(id));
        }),
      moveGroup: (id: string, body: GroupMoveBody) =>
        done(() => {
          patchGroups(qc, budgetId, (g) => withGroupMoved(g, id, body));
          return moveGroup(budgetId, id, body, rec());
        }),
      deleteGroup: (id: string, reassignTo?: string) =>
        done(() => deleteGroup(budgetId, id, reassignTo, rec())),
      deleteCategory: (id: string, reassignTo?: string) =>
        done(() => deleteCategory(budgetId, id, reassignTo, rec(id))),
      unhideAll: () => done(() => unhideAll(budgetId, rec())),
      groupUsage: (id: string) => groupUsage(budgetId, id),
      categoryUsage: (id: string) => categoryUsage(budgetId, id),
    };
  }, [qc, budgetId]);
}

function setCollapsedInCache(qc: QueryClient, budgetId: string, ids: string[], collapsed: boolean) {
  qc.setQueriesData<MonthDetail>({ queryKey: ["month", budgetId] }, (d) =>
    d
      ? {
          ...d,
          groups: d.groups.map((g) => (ids.includes(g.id) ? { ...g, collapsed } : g)),
        }
      : d,
  );
}

/** Per plan: the PATCHes run one after another, so the last collapse sent is the last the server gets. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Collapses or expands groups: the cached months change at once, one PATCH per changed group is sent (in
 * order), and a group whose PATCH fails goes back. The months are refetched when no write is pending.
 */
export async function setGroupsCollapsed(
  qc: QueryClient,
  budgetId: string,
  ids: string[],
  collapsed: boolean,
): Promise<void> {
  if (ids.length === 0) return;
  await beginWrite(qc, budgetId);
  setCollapsedInCache(qc, budgetId, ids, collapsed);
  const tail = (queues.get(budgetId) ?? Promise.resolve()).then(() =>
    Promise.all(
      ids.map((id) =>
        updateGroup(budgetId, id, { collapsed }).catch(() => {
          setCollapsedInCache(qc, budgetId, [id], !collapsed);
        }),
      ),
    ),
  );
  queues.set(budgetId, tail);
  try {
    await tail;
  } finally {
    endWrite(qc, budgetId);
  }
}

/** The note as the server stores it: trimmed at both ends, empty means none. */
export const normalizeNote = (note: string): string | null => note.trim() || null;

function withCategoryNote(d: MonthDetail, id: string, note: string | null): MonthDetail {
  return {
    ...d,
    groups: d.groups.map((g) => ({
      ...g,
      categories: g.categories.map((c) => (c.id === id ? { ...c, note } : c)),
    })),
  };
}

/**
 * Saves a category's note. The category id travels in the variables, so a change of selection during the save
 * cannot retarget it. The cached months change at once (through the one write rule of monthCache.ts); a failure
 * puts `before` back only where the value written is still there.
 */
export function useSetCategoryNote(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { categoryId: string; before: string | null; note: string }) =>
      // One after another: an absolute write must not be overtaken by a later save of the same note.
      inOrder(budgetId, () => setCategoryNote(budgetId, v.categoryId, normalizeNote(v.note))),
    onMutate: async (v) => {
      await beginWrite(qc, budgetId);
      const value = normalizeNote(v.note);
      qc.setQueriesData<MonthDetail>(
        { queryKey: ["month", budgetId] },
        (d) => d && withCategoryNote(d, v.categoryId, value),
      );
    },
    onError: (_e, v) => {
      const value = normalizeNote(v.note);
      qc.setQueriesData<MonthDetail>({ queryKey: ["month", budgetId] }, (d) => {
        const cur = d?.groups.flatMap((g) => g.categories).find((c) => c.id === v.categoryId)?.note;
        return d && cur === value ? withCategoryNote(d, v.categoryId, v.before) : d;
      });
    },
    onSettled: () => endWrite(qc, budgetId),
  });
}
