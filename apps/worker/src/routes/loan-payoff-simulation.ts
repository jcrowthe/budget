import { ErrorBody } from "@budget/schema/common/envelope";
import {
  LoanPayoffSimulationRequest,
  LoanPayoffSimulationResponse,
} from "@budget/schema/loan-simulator";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { simulateLoanPayoff } from "../services/loan-payoff-simulation";
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
    method: "post",
    path: "/budgets/{budget_id}/accounts/{account_id}/payoff-simulation",
    tags: ["Accounts"],
    summary:
      "Simulate a loan's payoff with a monthly payment and a one-time extra (read-only; the Payoff Simulator's numbers)",
    request: {
      params: z.object({ budget_id: param("budget_id"), account_id: param("account_id") }),
      body: {
        content: { "application/json": { schema: LoanPayoffSimulationRequest } },
        required: false,
      },
    },
    responses: {
      200: json(LoanPayoffSimulationResponse, "The simulation and the loan as it is"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan or account not found"),
      422: json(ErrorBody, "Not a loan account, no payment to simulate, or an invalid request"),
    },
  }),
  async (c) => {
    const { budget_id, account_id } = c.req.valid("param");
    try {
      const data = await simulateLoanPayoff(
        c.env,
        budget_id,
        account_id,
        c.req.valid("json") ?? {},
      );
      return c.json({ data }, 200);
    } catch (e) {
      if (e instanceof TransactionRefused) {
        return apiError(c, e.status, e.code, e.message) as never;
      }
      throw e;
    }
  },
);
