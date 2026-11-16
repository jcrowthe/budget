import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const CategoryGroup = z
  .object({
    id: z.uuid(),
    budget_id: z.uuid(),
    name: z.string(),
    sort: z.number().int(),
    hidden: z.boolean(),
    collapsed: z.boolean(),
  })
  .openapi("CategoryGroup");

export const Category = z
  .object({
    id: z.uuid(),
    budget_id: z.uuid(),
    group_id: z.uuid(),
    name: z.string(),
    sort: z.number().int(),
    hidden: z.boolean(),
    note: z.string().nullable(),
  })
  .openapi("Category");

/** The longest category note, in characters (the month note's cap). */
export const CATEGORY_NOTE_MAX = 5000;

const name = z.string().trim().min(1).max(100);

export const CategoryGroupCreate = z
  .object({ budget_id: z.uuid(), name, hidden: z.boolean().optional() })
  .openapi("CategoryGroupCreate");

export const CategoryCreate = z
  .object({ budget_id: z.uuid(), group_id: z.uuid(), name, hidden: z.boolean().optional() })
  .openapi("CategoryCreate");

export type CategoryGroup = z.infer<typeof CategoryGroup>;
export type Category = z.infer<typeof Category>;
export type CategoryGroupCreate = z.infer<typeof CategoryGroupCreate>;
export type CategoryCreate = z.infer<typeof CategoryCreate>;

// EXF-494, EXF-495: the category and group routes.
const groupName = z.string().trim().min(1, "The group name is required.").max(100);
const categoryName = z.string().trim().min(1, "The category name is required.").max(100);
const something = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);

export const CategoryGroupNew = z.object({ name: groupName }).openapi("CategoryGroupNew");

// group_id is not a uuid check: an unknown or malformed id answers 404, not 422.
export const CategoryNew = z
  .object({ group_id: z.string().min(1), name: categoryName })
  .openapi("CategoryNew");

export const CategoryGroupUpdate = z
  .object({
    name: groupName.optional(),
    hidden: z.boolean().optional(),
    collapsed: z.boolean().optional(),
  })
  .refine(something, "Nothing to update")
  .openapi("CategoryGroupUpdate");

export const CategoryUpdate = z
  .object({
    name: categoryName.optional(),
    hidden: z.boolean().optional(),
    note: z.string().max(CATEGORY_NOTE_MAX).nullable().optional(),
  })
  .refine(something, "Nothing to update")
  .openapi("CategoryUpdate");

export const CategoryUsage = z
  .object({
    category_count: z.number().int(),
    transaction_count: z.number().int(),
    has_assigned: z.boolean(),
    has_history: z.boolean(),
  })
  .openapi("CategoryUsage");

export const CategoryDeleted = z
  .object({
    category_ids: z.array(z.uuid()),
    group_id: z.uuid().nullable(),
    reassigned_to: z.uuid().nullable(),
    transactions_moved: z.number().int(),
    months_merged: z.number().int(),
  })
  .openapi("CategoryDeleted");

export const CategoriesUnhidden = z
  .object({ group_ids: z.array(z.uuid()), category_ids: z.array(z.uuid()) })
  .openapi("CategoriesUnhidden");

export const CategoryGroupResponse = dataEnvelope(
  z.object({ category_group: CategoryGroup }),
).openapi("CategoryGroupResponse");
export const CategoryResponse = dataEnvelope(z.object({ category: Category })).openapi(
  "CategoryResponse",
);
export const CategoryUsageResponse = dataEnvelope(z.object({ usage: CategoryUsage })).openapi(
  "CategoryUsageResponse",
);
export const CategoryDeletedResponse = dataEnvelope(z.object({ deleted: CategoryDeleted })).openapi(
  "CategoryDeletedResponse",
);
export const CategoriesUnhiddenResponse = dataEnvelope(
  z.object({ unhidden: CategoriesUnhidden }),
).openapi("CategoriesUnhiddenResponse");

export type CategoryGroupNew = z.infer<typeof CategoryGroupNew>;
export type CategoryNew = z.infer<typeof CategoryNew>;
export type CategoryGroupUpdate = z.infer<typeof CategoryGroupUpdate>;
export type CategoryUpdate = z.infer<typeof CategoryUpdate>;
export type CategoryUsage = z.infer<typeof CategoryUsage>;
export type CategoryDeleted = z.infer<typeof CategoryDeleted>;
export type CategoriesUnhidden = z.infer<typeof CategoriesUnhidden>;
