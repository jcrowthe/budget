import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

/** The built-in chips whose position can be saved. All and Overspent are fixed first and never in the order. */
export const BUILTIN_VIEW_KEYS = [
  "underfunded",
  "overfunded",
  "money_available",
  "snoozed",
] as const;
export type BuiltinViewKey = (typeof BUILTIN_VIEW_KEYS)[number];
export const isBuiltinViewKey = (s: string): s is BuiltinViewKey =>
  (BUILTIN_VIEW_KEYS as readonly string[]).includes(s);

export const CUSTOM_VIEW_NAME_MAX = 100;
export const CUSTOM_VIEW_CATEGORIES_MAX = 500;

export const CUSTOM_VIEW_ERRORS = {
  nameRequired: "The view name is required.",
  nameTooLong: `The view name can be at most ${CUSTOM_VIEW_NAME_MAX} characters.`,
  noField: "Give name or category_ids",
  builtin: "Built-in views can only be reordered.",
  reorder: "ids must list every view exactly once.",
} as const;

export const CustomViewName = z
  .string({ error: CUSTOM_VIEW_ERRORS.nameRequired })
  .trim()
  .min(1, CUSTOM_VIEW_ERRORS.nameRequired)
  .max(CUSTOM_VIEW_NAME_MAX, CUSTOM_VIEW_ERRORS.nameTooLong);

const CategoryIds = z
  .array(z.string().min(1))
  .max(CUSTOM_VIEW_CATEGORIES_MAX, `A view holds at most ${CUSTOM_VIEW_CATEGORIES_MAX} categories`);

export const CustomView = z
  .object({
    id: z.string(),
    name: z.string(),
    category_ids: z.array(z.string()),
    sort_order: z.number(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi("CustomView");
export type CustomView = z.infer<typeof CustomView>;

export const CustomViewCreate = z
  .strictObject({ name: CustomViewName, category_ids: CategoryIds.default([]) })
  .openapi("CustomViewCreate");
export type CustomViewCreate = z.infer<typeof CustomViewCreate>;

export const CustomViewUpdate = z
  .strictObject({ name: CustomViewName.optional(), category_ids: CategoryIds.optional() })
  .refine((v) => v.name !== undefined || v.category_ids !== undefined, {
    message: CUSTOM_VIEW_ERRORS.noField,
  })
  .openapi("CustomViewUpdate");
export type CustomViewUpdate = z.infer<typeof CustomViewUpdate>;

export const CustomViewReorder = z
  .strictObject({ ids: z.array(z.string().min(1)).min(1, CUSTOM_VIEW_ERRORS.reorder) })
  .openapi("CustomViewReorder");
export type CustomViewReorder = z.infer<typeof CustomViewReorder>;

/** The chip order (built-in keys and custom ids) and the custom views, in that order. */
export const CustomViewsList = z
  .object({ order: z.array(z.string()), views: z.array(CustomView) })
  .openapi("CustomViewsList");
export type CustomViewsList = z.infer<typeof CustomViewsList>;

export const CustomViewResponse = dataEnvelope(z.object({ view: CustomView })).openapi(
  "CustomViewResponse",
);
export const CustomViewsResponse = dataEnvelope(CustomViewsList).openapi("CustomViewsResponse");
export const CustomViewDeleteResponse = dataEnvelope(z.object({ view: CustomView })).openapi(
  "CustomViewDeleteResponse",
);

export const CustomViewIdParam = z.object({
  budget_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "budget_id", in: "path" } }),
  view_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "view_id", in: "path" } }),
});
export const CustomViewBudgetParam = z.object({
  budget_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "budget_id", in: "path" } }),
});

export const customViewEmptyText = (name: string): string =>
  `There are no categories selected for ${name}.`;

/**
 * The ids to save when a view is edited: stored members the dialog did not show (hidden ones) stay, then the
 * checked ones are added; each id once.
 */
export function editedViewCategoryIds(
  stored: readonly string[],
  shownIds: readonly string[],
  checked: readonly string[],
): string[] {
  const shown = new Set(shownIds);
  return [...new Set([...stored.filter((id) => !shown.has(id)), ...checked])];
}
