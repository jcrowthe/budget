import { ErrorBody } from "@budget/schema/common/envelope";
import { TargetBody, TargetDeletedResponse, TargetResponse, Today } from "@budget/schema/targets";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ZodError } from "zod";
import type { AppEnv } from "../env";
import { apiError, NotFound } from "../middleware/errors";
import { deleteTarget, setTarget } from "../services/targets";

const tags = ["Targets"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan, category or target not found"),
  409: json(ErrorBody, "The target was changed concurrently"),
  422: json(ErrorBody, "Invalid target or date"),
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

const params = z.object({
  budget_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "budget_id", in: "path" } }),
  category_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "category_id", in: "path" } }),
});

const isId = (s: string) => z.uuid().safeParse(s).success;
const requireIds = (budgetId: string, categoryId: string) => {
  if (!isId(budgetId)) throw new NotFound("Plan");
  if (!isId(categoryId)) throw new NotFound("Category");
};

export default app
  .openapi(
    createRoute({
      method: "put",
      path: "/budgets/{budget_id}/categories/{category_id}/target",
      tags,
      request: {
        params,
        query: z.object({
          today: Today.optional().openapi({
            description:
              "The owner's local date (YYYY-MM-DD): the creation date of a new target. Default: the server's UTC date",
          }),
        }),
        body: { required: true, content: { "application/json": { schema: TargetBody } } },
      },
      responses: { 200: json(TargetResponse, "The stored target"), ...errors },
    }),
    async (c) => {
      const { budget_id, category_id } = c.req.valid("param");
      const { today } = c.req.valid("query");
      requireIds(budget_id, category_id);
      try {
        const target = await setTarget(
          c.env,
          c.get("identity").actor,
          { budget_id, category_id, ...c.req.valid("json") },
          { today },
        );
        return c.json({ data: { target } }, 200);
      } catch (e) {
        if (e instanceof ZodError) {
          return apiError(
            c,
            422,
            "unprocessable_entity",
            e.issues.map((i) => i.message).join("; "),
          ) as never;
        }
        throw e;
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/budgets/{budget_id}/categories/{category_id}/target",
      tags,
      request: { params },
      responses: { 200: json(TargetDeletedResponse, "The target as it was"), ...errors },
    }),
    async (c) => {
      const { budget_id, category_id } = c.req.valid("param");
      requireIds(budget_id, category_id);
      const deleted = await deleteTarget(c.env, c.get("identity").actor, {
        budget_id,
        category_id,
      });
      return c.json({ data: { deleted } }, 200);
    },
  );
