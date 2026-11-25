import { ErrorBody } from "@budget/schema/common/envelope";
import { RecentMovesQuery, RecentMovesResponse } from "@budget/schema/recent-moves";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { listRecentMoves } from "../services/recent-moves";

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
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

export default app.openapi(
  createRoute({
    method: "get",
    path: "/budgets/{budget_id}/moves",
    tags: ["Months"],
    request: {
      params: z.object({
        budget_id: z
          .string()
          .min(1)
          .openapi({ param: { name: "budget_id", in: "path" } }),
      }),
      query: RecentMovesQuery,
    },
    responses: {
      200: json(RecentMovesResponse, "The plan's recent assigning and money moves, newest first"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan not found"),
      422: json(ErrorBody, "Invalid since or type"),
    },
  }),
  async (c) => {
    const { budget_id } = c.req.valid("param");
    const { since, type } = c.req.valid("query");
    const data = await listRecentMoves(c.env, c.get("identity").actor, { budget_id, since, type });
    return c.json({ data }, 200);
  },
);
