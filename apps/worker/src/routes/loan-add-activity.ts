import { ErrorBody } from "@budget/schema/common/envelope";
import { LoanAddActivityRequest, LoanAddActivityResponse } from "@budget/schema/loan-add-activity";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { addLoanActivity } from "../services/loan-add-activity";
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
    path: "/budgets/{budget_id}/accounts/{account_id}/activity",
    tags: ["Accounts"],
    summary:
      "Add activity to a loan: recorded interest (added to the month), a mortgage's known escrow for a month (the month's total, replacing what is not reconciled), a fee or charge, or a credit",
    request: {
      params: z.object({ budget_id: param("budget_id"), account_id: param("account_id") }),
      body: {
        content: { "application/json": { schema: LoanAddActivityRequest } },
        required: true,
      },
    },
    responses: {
      201: json(LoanAddActivityResponse, "The row written and the loan's balance"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan or account not found"),
      409: json(ErrorBody, "The loan's balance changed while writing (balance_changed)"),
      422: json(
        ErrorBody,
        "Not a loan, closed, escrow on a non-mortgage, a future interest or escrow month, an escrow total at or below its reconciled part, or an invalid request",
      ),
    },
  }),
  async (c) => {
    const { budget_id, account_id } = c.req.valid("param");
    try {
      const data = await addLoanActivity(
        c.env,
        c.get("identity").actor,
        budget_id,
        account_id,
        c.req.valid("json"),
      );
      return c.json({ data }, 201);
    } catch (e) {
      if (e instanceof TransactionRefused) {
        return apiError(c, e.status, e.code, e.message) as never;
      }
      throw e;
    }
  },
);
