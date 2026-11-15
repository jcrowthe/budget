import { z } from "@hono/zod-openapi";

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
  })
  .openapi("Category");

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
