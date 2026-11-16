import { ErrorBody } from "@budget/schema/common/envelope";
import { UiStatePatch, UiStateResponse } from "@budget/schema/ui-state";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { getUiState, setUiState } from "../services/ui-state";

const tags = ["Interface state"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const budgetParam = z
  .string()
  .min(1)
  .openapi({ param: { name: "budget_id", in: "path" } });
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan not found"),
  422: json(ErrorBody, "Invalid request"),
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
      method: "get",
      path: "/budgets/{budget_id}/ui-state",
      tags,
      request: { params: z.object({ budget_id: budgetParam }) },
      responses: { 200: json(UiStateResponse, "The plan's interface state"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      return c.json({ data: { ui_state: await getUiState(c.env, budget_id) } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/budgets/{budget_id}/ui-state",
      tags,
      request: {
        params: z.object({ budget_id: budgetParam }),
        body: { content: { "application/json": { schema: UiStatePatch } }, required: true },
      },
      responses: { 200: json(UiStateResponse, "The merged interface state"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const ui_state = await setUiState(c.env, budget_id, c.req.valid("json"));
      return c.json({ data: { ui_state } }, 200);
    },
  );
