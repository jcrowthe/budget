import { ErrorBody } from "@budget/schema/common/envelope";
import {
  ReconcileConflictBody,
  ReconcileRequest,
  ReconcileResponse,
} from "@budget/schema/reconcile";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { ReconcileRefused, reconcileAccount } from "../services/reconcile";

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const param = (name: string) =>
  z
    .string()
    .min(1)
    .openapi({ param: { name, in: "path" } });

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
}).openapi(
  createRoute({
    method: "post",
    path: "/budgets/{budget_id}/accounts/{account_id}/reconcile",
    tags: ["Accounts"],
    request: {
      params: z.object({ budget_id: param("budget_id"), account_id: param("account_id") }),
      body: { content: { "application/json": { schema: ReconcileRequest } }, required: true },
    },
    responses: {
      200: json(ReconcileResponse, "The account, the number of rows reconciled and the adjustment"),
      409: json(
        ReconcileConflictBody,
        "The bank balance differs and no adjustment was asked for (reconcile_difference), or the cleared balance is no longer the confirmed one (reconcile_changed); carries the difference",
      ),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan or account not found"),
      422: json(ErrorBody, "Invalid request, or the account is closed"),
    },
  }),
  async (c) => {
    const { budget_id, account_id } = c.req.valid("param");
    try {
      const data = await reconcileAccount(
        c.env,
        c.get("identity").actor,
        budget_id,
        account_id,
        c.req.valid("json"),
      );
      return c.json({ data }, 200);
    } catch (e) {
      if (e instanceof ReconcileRefused) {
        if (e.status === 409) {
          return c.json(
            {
              error: {
                id: "409",
                name: e.code as "reconcile_difference" | "reconcile_changed",
                detail: e.message,
                difference: e.difference ?? 0,
                cleared_balance: e.cleared ?? 0,
              },
            },
            409,
          );
        }
        return apiError(c, 422, e.code, e.message) as never;
      }
      throw e;
    }
  },
);

export default app;
