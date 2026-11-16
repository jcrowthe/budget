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
import { apiFetch } from "./client";
import { beginWrite, endWrite, inOrder } from "./monthCache";

const base = (b: string) => `/api/v1/budgets/${b}` as const;
const write = { idempotencyKey: undefined as string | undefined };
const key = () => ({ ...write, idempotencyKey: crypto.randomUUID() });
const reassign = (to?: string) => (to ? `?reassign_to=${encodeURIComponent(to)}` : "");

export const createGroup = async (b: string, name: string) =>
  (
    await apiFetch(`${base(b)}/category_groups`, {
      method: "POST",
      body: { name },
      schema: CategoryGroupResponse,
      ...key(),
    })
  ).data.category_group;

export const createCategory = async (b: string, groupId: string, name: string) =>
  (
    await apiFetch(`${base(b)}/categories`, {
      method: "POST",
      body: { group_id: groupId, name },
      schema: CategoryResponse,
      ...key(),
    })
  ).data.category;

export const updateGroup = async (
  b: string,
  id: string,
  patch: { name?: string; hidden?: boolean; collapsed?: boolean },
) =>
  (
    await apiFetch(`${base(b)}/category_groups/${id}`, {
      method: "PATCH",
      body: patch,
      schema: CategoryGroupResponse,
      ...key(),
    })
  ).data.category_group;

export const updateCategory = async (
  b: string,
  id: string,
  patch: { name?: string; hidden?: boolean },
) =>
  (
    await apiFetch(`${base(b)}/categories/${id}`, {
      method: "PATCH",
      body: patch,
      schema: CategoryResponse,
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

export const deleteGroup = async (b: string, id: string, reassignTo?: string) =>
  (
    await apiFetch(`${base(b)}/category_groups/${id}${reassign(reassignTo)}`, {
      method: "DELETE",
      schema: CategoryDeletedResponse,
      ...key(),
    })
  ).data.deleted;

export const deleteCategory = async (b: string, id: string, reassignTo?: string) =>
  (
    await apiFetch(`${base(b)}/categories/${id}${reassign(reassignTo)}`, {
      method: "DELETE",
      schema: CategoryDeletedResponse,
      ...key(),
    })
  ).data.deleted;

export const unhideAll = async (b: string) =>
  (
    await apiFetch(`${base(b)}/categories/unhide_all`, {
      method: "POST",
      schema: CategoriesUnhiddenResponse,
      ...key(),
    })
  ).data.unhidden;

/** The writes of the grid, each refetching the plan's months when it succeeds. */
export function useCategoryActions(budgetId: string) {
  const qc = useQueryClient();
  return useMemo(() => {
    const done =
      <A extends unknown[], R>(fn: (b: string, ...a: A) => Promise<R>) =>
      async (...a: A): Promise<R> => {
        await beginWrite(qc, budgetId);
        try {
          return await fn(budgetId, ...a);
        } finally {
          endWrite(qc, budgetId);
        }
      };
    return {
      createGroup: done(createGroup),
      createCategory: done(createCategory),
      updateGroup: done(updateGroup),
      updateCategory: done(updateCategory),
      deleteGroup: done(deleteGroup),
      deleteCategory: done(deleteCategory),
      unhideAll: done(unhideAll),
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
