import { ErrorBody } from "@budget/schema/common/envelope";
import {
  CustomViewBudgetParam,
  CustomViewCreate,
  CustomViewDeleteResponse,
  CustomViewIdParam,
  CustomViewReorder,
  CustomViewResponse,
  CustomViewsResponse,
  CustomViewUpdate,
} from "@budget/schema/custom-views";
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  createView,
  deleteView,
  listViews,
  reorderViews,
  updateView,
} from "../services/custom-views";

const tags = ["Views"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true as const,
});

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

const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan, view or category not found"),
  409: json(ErrorBody, "Conflict"),
  422: json(ErrorBody, "Invalid request"),
};

const base = "/budgets/{budget_id}/views";

export default app
  .openapi(
    createRoute({
      method: "get",
      path: base,
      tags,
      summary: "List the plan's views",
      description:
        "`order` is the chip order after All and Overspent: the four built-in keys (underfunded, overfunded, money_available, snoozed) and the custom view ids. `views` are the custom views in that order. A deleted category is left out of `category_ids`; a hidden one is kept.",
      request: { params: CustomViewBudgetParam },
      responses: { 200: json(CustomViewsResponse, "The order and the custom views"), ...errors },
    }),
    async (c) => c.json({ data: await listViews(c.env, c.req.valid("param").budget_id) }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: base,
      tags,
      summary: "Create a custom view",
      request: { params: CustomViewBudgetParam, body: body(CustomViewCreate) },
      responses: { 201: json(CustomViewResponse, "The new view, last in the order"), ...errors },
    }),
    async (c) => {
      const view = await createView(
        c.env,
        c.get("identity").actor,
        c.req.valid("param").budget_id,
        c.req.valid("json"),
      );
      return c.json({ data: { view } }, 201);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: `${base}/reorder`,
      tags,
      summary: "Reorder the chips",
      description:
        "`ids` lists every built-in key and every live custom view id exactly once, in the new order.",
      request: { params: CustomViewBudgetParam, body: body(CustomViewReorder) },
      responses: { 200: json(CustomViewsResponse, "The new order"), ...errors },
    }),
    async (c) => {
      const data = await reorderViews(
        c.env,
        c.get("identity").actor,
        c.req.valid("param").budget_id,
        c.req.valid("json"),
      );
      return c.json({ data }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: `${base}/{view_id}`,
      tags,
      summary: "Rename a custom view or replace its categories",
      description: "A built-in key is 422: built-in views can only be reordered.",
      request: { params: CustomViewIdParam, body: body(CustomViewUpdate) },
      responses: { 200: json(CustomViewResponse, "The updated view"), ...errors },
    }),
    async (c) => {
      const { budget_id, view_id } = c.req.valid("param");
      const view = await updateView(
        c.env,
        c.get("identity").actor,
        budget_id,
        view_id,
        c.req.valid("json"),
      );
      return c.json({ data: { view } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: `${base}/{view_id}`,
      tags,
      summary: "Delete a custom view",
      description: "A built-in key is 422: built-in views can only be reordered.",
      request: { params: CustomViewIdParam },
      responses: { 200: json(CustomViewDeleteResponse, "The view as it was"), ...errors },
    }),
    async (c) => {
      const { budget_id, view_id } = c.req.valid("param");
      const view = await deleteView(c.env, c.get("identity").actor, budget_id, view_id);
      return c.json({ data: { view } }, 200);
    },
  );
