import { ErrorBody } from "@budget/schema/common/envelope";
import { LoanSummaryQuery, LoanSummaryResponse } from "@budget/schema/loan-summary";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { getLoanSummary } from "../services/loan-summary";
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
    path: "/budgets/{budget_id}/accounts/{account_id}/summary",
    tags: ["Accounts"],
    summary:
      "A loan's summary: balance, terms, payoff projection, progress series and paired category",
    request: {
      params: z.object({ budget_id: param("budget_id"), account_id: param("account_id") }),
      query: LoanSummaryQuery,
    },
    responses: {
      200: json(LoanSummaryResponse, "The loan summary"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan or account not found"),
      422: json(ErrorBody, "Not a loan account, or a bad month"),
    },
  }),
  async (c) => {
    const { budget_id, account_id } = c.req.valid("param");
    try {
      const data = await getLoanSummary(c.env, budget_id, account_id, c.req.valid("query").month);
      return c.json({ data }, 200);
    } catch (e) {
      if (e instanceof TransactionRefused) {
        return apiError(c, e.status, e.code, e.message) as never;
      }
      throw e;
    }
  },
);
