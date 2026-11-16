import {
  CategoriesUnhiddenResponse,
  CategoryDeletedResponse,
  CategoryNew,
  CategoryResponse,
  CategoryUpdate,
  CategoryUsageResponse,
} from "@budget/schema/categories";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { addCategory, unhideAll, updateCategory } from "../services/categories";
import { categoryUsage, deleteCategory } from "../services/category-delete";
import { categoryError } from "./category-groups";

const tags = ["Categories"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const param = (name: string) =>
  z
    .string()
    .min(1)
    .openapi({ param: { name, in: "path" } });
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan, category group or category not found"),
  409: json(
    ErrorBody,
    "The category has history and reassign_to is missing, or a concurrent change",
  ),
  422: json(
    ErrorBody,
    "Invalid request, duplicate name, invalid reassign_to, or payment_group_locked / payment_category_locked (the Credit Card Payments group and its categories)",
  ),
};

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return apiError(
        c,
        422,
        "unprocessable_entity",
        result.error.issues.map((i) => i.message).join("; "),
      );
    }
  },
});

export default app
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/categories",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id") }),
        body: { content: { "application/json": { schema: CategoryNew } }, required: true },
      },
      responses: {
        201: json(CategoryResponse, "The new category, at the top of its group"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      try {
        const category = await addCategory(c.env, c.get("identity").actor, {
          budget_id,
          ...c.req.valid("json"),
        });
        return c.json({ data: { category } }, 201);
      } catch (e) {
        return categoryError(c, e) as never;
      }
    },
  )
  // Registered before the {category_id} routes so "unhide_all" is never read as an id.
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/categories/unhide_all",
      tags,
      request: { params: z.object({ budget_id: param("budget_id") }) },
      responses: { 200: json(CategoriesUnhiddenResponse, "The ids that were unhidden"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const unhidden = await unhideAll(c.env, c.get("identity").actor, budget_id);
      return c.json({ data: { unhidden } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/budgets/{budget_id}/categories/{category_id}",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id"), category_id: param("category_id") }),
        body: { content: { "application/json": { schema: CategoryUpdate } }, required: true },
      },
      responses: { 200: json(CategoryResponse, "The updated category"), ...errors },
    }),
    async (c) => {
      const { budget_id, category_id } = c.req.valid("param");
      try {
        const category = await updateCategory(c.env, c.get("identity").actor, {
          budget_id,
          category_id,
          ...c.req.valid("json"),
        });
        return c.json({ data: { category } }, 200);
      } catch (e) {
        return categoryError(c, e) as never;
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/budgets/{budget_id}/categories/{category_id}",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id"), category_id: param("category_id") }),
        query: z.object({ reassign_to: z.string().min(1).optional() }),
      },
      responses: { 200: json(CategoryDeletedResponse, "What was deleted and moved"), ...errors },
    }),
    async (c) => {
      const { budget_id, category_id } = c.req.valid("param");
      try {
        const deleted = await deleteCategory(c.env, c.get("identity").actor, {
          budget_id,
          category_id,
          reassign_to: c.req.valid("query").reassign_to,
        });
        return c.json({ data: { deleted } }, 200);
      } catch (e) {
        return categoryError(c, e) as never;
      }
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/categories/{category_id}/usage",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id"), category_id: param("category_id") }),
      },
      responses: { 200: json(CategoryUsageResponse, "The category's history"), ...errors },
    }),
    async (c) => {
      const { budget_id, category_id } = c.req.valid("param");
      return c.json({ data: { usage: await categoryUsage(c.env, budget_id, category_id) } }, 200);
    },
  );
