import { ErrorBody } from "@budget/schema/common/envelope";
import { LoanActivityQuery, LoanActivityResponse } from "@budget/schema/loan-activity";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { getLoanActivity } from "../services/loan-activity";
import { TransactionRefused } from "../services/transactions";

const param = (name: string) =>
  z
    .string()
    .min(1)
    .openapi({ param: { name, in: "path" } });
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
    path: "/budgets/{budget_id}/accounts/{account_id}/activity",
    tags: ["Accounts"],
    summary: "A loan's Account Activity for one month: payments, interest, escrow and other rows",
    request: {
      params: z.object({ budget_id: param("budget_id"), account_id: param("account_id") }),
      query: LoanActivityQuery,
    },
    responses: {
      200: json(LoanActivityResponse, "The month's activity and the loan's balance at its end"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan or account not found"),
      422: json(ErrorBody, "Not a loan account, or a bad month"),
    },
  }),
  async (c) => {
    const { budget_id, account_id } = c.req.valid("param");
    try {
      const data = await getLoanActivity(c.env, budget_id, account_id, c.req.valid("query").month);
      return c.json({ data }, 200);
    } catch (e) {
      if (e instanceof TransactionRefused) {
        return apiError(c, e.status, e.code, e.message) as never;
      }
      throw e;
    }
  },
);
