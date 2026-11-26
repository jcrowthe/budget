import { ErrorBody } from "@budget/schema/common/envelope";
import { LoanActivityChangeResponse, LoanActivityPatchRequest } from "@budget/schema/loan-manage";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { deleteLoanActivity, updateLoanActivity } from "../services/loan-manage-activity";
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

const path = "/budgets/{budget_id}/accounts/{account_id}/activity/{transaction_id}";
const params = z.object({
  budget_id: param("budget_id"),
  account_id: param("account_id"),
  transaction_id: param("transaction_id"),
});
const responses = {
  200: json(
    LoanActivityChangeResponse,
    "The row written (null after a delete) and the loan's balance",
  ),
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan, account or row not found"),
  409: json(ErrorBody, "A reconciled line (reconciled_line), or the balance changed while writing"),
  422: json(ErrorBody, "Not a loan, closed, not an editable row, or an invalid request"),
};

export default app
  .openapi(
    createRoute({
      method: "patch",
      path,
      tags: ["Accounts"],
      summary:
        "Edit a recorded interest or escrow line, a fee, a credit or a payment on a loan (an escrow line's amount is the month's total; a payment changes both sides)",
      request: {
        params,
        body: {
          content: { "application/json": { schema: LoanActivityPatchRequest } },
          required: true,
        },
      },
      responses,
    }),
    async (c) => {
      const { budget_id, account_id, transaction_id } = c.req.valid("param");
      try {
        const data = await updateLoanActivity(
          c.env,
          c.get("identity").actor,
          budget_id,
          account_id,
          transaction_id,
          c.req.valid("json"),
        );
        return c.json({ data }, 200);
      } catch (e) {
        if (e instanceof TransactionRefused) {
          return apiError(c, e.status, e.code, e.message) as never;
        }
        throw e;
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path,
      tags: ["Accounts"],
      summary:
        "Delete a recorded interest or escrow line, a fee, a credit or a payment on a loan (an escrow line returns to its estimate; a payment is removed from both accounts)",
      request: { params },
      responses,
    }),
    async (c) => {
      const { budget_id, account_id, transaction_id } = c.req.valid("param");
      try {
        const data = await deleteLoanActivity(
          c.env,
          c.get("identity").actor,
          budget_id,
          account_id,
          transaction_id,
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
