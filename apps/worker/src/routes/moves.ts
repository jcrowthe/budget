import { ErrorBody } from "@budget/schema/common/envelope";
import { InputMonth } from "@budget/schema/months";
import { CoverCreate, MoveCreate, MoveResultResponse } from "@budget/schema/moves";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { coverAndRead, moveAndRead } from "../services/moves";

const tags = ["Months"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan or category not found"),
  409: json(ErrorBody, "The amounts were changed concurrently"),
  422: json(ErrorBody, "Invalid month, amount or sides, or the category is not overspent"),
};

const idParam = (name: string) =>
  z
    .string()
    .min(1)
    .openapi({ param: { name, in: "path" } });
const month = InputMonth.openapi({ param: { name: "month", in: "path" } });

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
      path: "/budgets/{budget_id}/months/{month}/moves",
      tags,
      request: {
        params: z.object({ budget_id: idParam("budget_id"), month }),
        body: { required: true, content: { "application/json": { schema: MoveCreate } } },
      },
      responses: {
        200: json(MoveResultResponse, "The moved amounts and Ready to Assign"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, month } = c.req.valid("param");
      const data = await moveAndRead(c.env, c.get("identity").actor, {
        budget_id,
        month,
        ...c.req.valid("json"),
      });
      return c.json({ data }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/months/{month}/categories/{category_id}/cover",
      tags,
      request: {
        params: z.object({
          budget_id: idParam("budget_id"),
          month,
          category_id: idParam("category_id"),
        }),
        body: { required: true, content: { "application/json": { schema: CoverCreate } } },
      },
      responses: {
        200: json(MoveResultResponse, "The moved amounts and Ready to Assign"),
        ...errors,
      },
    }),
    async (c) => {
      const data = await coverAndRead(c.env, c.get("identity").actor, {
        ...c.req.valid("param"),
        ...c.req.valid("json"),
      });
      return c.json({ data }, 200);
    },
  );
