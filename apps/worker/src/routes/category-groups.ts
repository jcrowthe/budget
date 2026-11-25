import {
  CategoryDeletedResponse,
  CategoryGroupMove,
  CategoryGroupNew,
  CategoryGroupResponse,
  CategoryGroupUpdate,
  CategoryUsageResponse,
} from "@budget/schema/categories";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  addCategoryGroup,
  HistoryExists,
  InvalidMoveTarget,
  InvalidReassignTarget,
  NameTaken,
  updateCategoryGroup,
} from "../services/categories";
import { deleteCategoryGroup, groupUsage } from "../services/category-delete";
import { moveCategoryGroup } from "../services/category-groups";
import { PaymentLocked } from "../services/credit-payments";

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
  404: json(ErrorBody, "Plan or category group not found"),
  409: json(ErrorBody, "The group has history and reassign_to is missing, or a concurrent change"),
  422: json(
    ErrorBody,
    "Invalid request, duplicate name, invalid reassign_to, invalid_move_target, or payment_group_locked / payment_category_locked (the Credit Card Payments group and its categories)",
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

/** Maps the category services' own errors; everything else falls through to onError. */
export function categoryError(c: Context, e: unknown) {
  if (e instanceof NameTaken) return apiError(c, 422, "name_taken", e.message);
  if (e instanceof InvalidReassignTarget) {
    return apiError(c, 422, "invalid_reassign_target", e.message);
  }
  if (e instanceof InvalidMoveTarget) return apiError(c, 422, "invalid_move_target", e.message);
  if (e instanceof PaymentLocked) return apiError(c, 422, e.code, e.message);
  if (e instanceof HistoryExists) return apiError(c, 409, "history_exists", e.message);
  throw e;
}

export default app
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/category_groups",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id") }),
        body: { content: { "application/json": { schema: CategoryGroupNew } }, required: true },
      },
      responses: { 201: json(CategoryGroupResponse, "The new group, at the top"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      try {
        const category_group = await addCategoryGroup(c.env, c.get("identity").actor, {
          budget_id,
          ...c.req.valid("json"),
        });
        return c.json({ data: { category_group } }, 201);
      } catch (e) {
        return categoryError(c, e) as never;
      }
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/budgets/{budget_id}/category_groups/{group_id}",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id"), group_id: param("group_id") }),
        body: { content: { "application/json": { schema: CategoryGroupUpdate } }, required: true },
      },
      responses: { 200: json(CategoryGroupResponse, "The updated group"), ...errors },
    }),
    async (c) => {
      const { budget_id, group_id } = c.req.valid("param");
      try {
        const category_group = await updateCategoryGroup(c.env, c.get("identity").actor, {
          budget_id,
          group_id,
          ...c.req.valid("json"),
        });
        return c.json({ data: { category_group } }, 200);
      } catch (e) {
        return categoryError(c, e) as never;
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/category_groups/{group_id}/move",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id"), group_id: param("group_id") }),
        body: { content: { "application/json": { schema: CategoryGroupMove } }, required: true },
      },
      responses: {
        200: json(CategoryGroupResponse, "The moved group, in its new position"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, group_id } = c.req.valid("param");
      try {
        const category_group = await moveCategoryGroup(c.env, c.get("identity").actor, {
          budget_id,
          group_id,
          ...c.req.valid("json"),
        });
        return c.json({ data: { category_group } }, 200);
      } catch (e) {
        return categoryError(c, e) as never;
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/budgets/{budget_id}/category_groups/{group_id}",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id"), group_id: param("group_id") }),
        query: z.object({ reassign_to: z.string().min(1).optional() }),
      },
      responses: { 200: json(CategoryDeletedResponse, "What was deleted and moved"), ...errors },
    }),
    async (c) => {
      const { budget_id, group_id } = c.req.valid("param");
      try {
        const deleted = await deleteCategoryGroup(c.env, c.get("identity").actor, {
          budget_id,
          group_id,
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
      path: "/budgets/{budget_id}/category_groups/{group_id}/usage",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id"), group_id: param("group_id") }),
      },
      responses: { 200: json(CategoryUsageResponse, "The group's history"), ...errors },
    }),
    async (c) => {
      const { budget_id, group_id } = c.req.valid("param");
      return c.json({ data: { usage: await groupUsage(c.env, budget_id, group_id) } }, 200);
    },
  );
