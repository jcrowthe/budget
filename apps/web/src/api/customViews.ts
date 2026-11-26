import {
  BUILTIN_VIEW_KEYS,
  type CustomView,
  CustomViewResponse,
  type CustomViewsList,
  CustomViewsResponse,
  isBuiltinViewKey,
} from "@budget/schema/custom-views";
import { VIEW_CHIP_LABEL } from "@budget/schema/plan-views";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

const base = (budgetId: string): `/api/v1/${string}` => `/api/v1/budgets/${budgetId}/views`;

/** Plan-wide invalidations (`queryKey.includes(budgetId)`) refetch it, so a deleted category leaves its views. */
export const customViewsKey = (budgetId: string) => ["custom-views", budgetId] as const;

export const useCustomViews = (budgetId: string) =>
  useQuery({
    queryKey: customViewsKey(budgetId),
    queryFn: async (): Promise<CustomViewsList> =>
      (await apiFetch(base(budgetId), { schema: CustomViewsResponse })).data,
    retry: false,
  });

export interface ChipEntry {
  /** A built-in key or a custom view's id. */
  key: string;
  label: string;
  custom: boolean;
}

/**
 * The chips after All and Overspent, in order. While the list loads the built-ins show in their default order and
 * no custom chip shows.
 */
export function chipOrder(list: CustomViewsList | undefined): ChipEntry[] {
  const order = list?.order ?? [...BUILTIN_VIEW_KEYS];
  const names = new Map((list?.views ?? []).map((v) => [v.id, v.name]));
  return order.flatMap((key): ChipEntry[] => {
    if (isBuiltinViewKey(key)) return [{ key, label: VIEW_CHIP_LABEL[key], custom: false }];
    const name = names.get(key);
    return name === undefined ? [] : [{ key, label: name, custom: true }];
  });
}

const apply = (
  list: CustomViewsList | undefined,
  change: (l: CustomViewsList) => CustomViewsList,
): CustomViewsList | undefined => (list ? change(list) : list);

export function useCreateView(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; category_ids: string[] }): Promise<CustomView> =>
      (await apiFetch(base(budgetId), { method: "POST", body, schema: CustomViewResponse })).data
        .view,
    onSuccess: (view) => {
      qc.setQueryData<CustomViewsList>(customViewsKey(budgetId), (l) =>
        apply(l, (x) => ({ order: [...x.order, view.id], views: [...x.views, view] })),
      );
      void qc.invalidateQueries({ queryKey: customViewsKey(budgetId) });
    },
  });
}

export function useUpdateView(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      id: string;
      name?: string;
      category_ids?: string[];
    }): Promise<CustomView> => {
      const { id, ...body } = v;
      return (
        await apiFetch(`${base(budgetId)}/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body,
          schema: CustomViewResponse,
        })
      ).data.view;
    },
    onSuccess: (view) => {
      qc.setQueryData<CustomViewsList>(customViewsKey(budgetId), (l) =>
        apply(l, (x) => ({ ...x, views: x.views.map((v) => (v.id === view.id ? view : v)) })),
      );
      void qc.invalidateQueries({ queryKey: customViewsKey(budgetId) });
    },
  });
}

export function useDeleteView(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<CustomView> =>
      (
        await apiFetch(`${base(budgetId)}/${encodeURIComponent(id)}`, {
          method: "DELETE",
          schema: CustomViewResponse,
        })
      ).data.view,
    onSuccess: (view) => {
      qc.setQueryData<CustomViewsList>(customViewsKey(budgetId), (l) =>
        apply(l, (x) => ({
          order: x.order.filter((k) => k !== view.id),
          views: x.views.filter((v) => v.id !== view.id),
        })),
      );
      void qc.invalidateQueries({ queryKey: customViewsKey(budgetId) });
    },
  });
}

/** The page changes at once; a failed save puts the old order back. */
export function useReorderViews(budgetId: string) {
  const qc = useQueryClient();
  const key = customViewsKey(budgetId);
  return useMutation({
    scope: { id: `custom-views-order:${budgetId}` },
    mutationFn: async (ids: string[]): Promise<CustomViewsList> =>
      (
        await apiFetch(`${base(budgetId)}/reorder`, {
          method: "POST",
          body: { ids },
          schema: CustomViewsResponse,
        })
      ).data,
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<CustomViewsList>(key);
      qc.setQueryData<CustomViewsList>(key, (l) =>
        apply(l, (x) => {
          const byId = new Map(x.views.map((v) => [v.id, v]));
          return {
            order: ids,
            views: ids.flatMap((k) => {
              const v = byId.get(k);
              return v ? [v] : [];
            }),
          };
        }),
      );
      return { previous };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}
