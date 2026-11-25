import { ErrorBody } from "@budget/schema/common/envelope";
import {
  LoanBalanceUpdateRequest,
  LoanBalanceUpdateResponse,
} from "@budget/schema/loan-balance-update";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { updateLoanBalance } from "../services/loan-balance-update";
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
    path: "/budgets/{budget_id}/accounts/{account_id}/balance-update",
    tags: ["Accounts"],
    summary:
      "Update a loan's balance: freeze its interest and escrow lines as Reconciled, add a balance adjustment for the difference and stamp the update",
    request: {
      params: z.object({ budget_id: param("budget_id"), account_id: param("account_id") }),
      body: {
        content: { "application/json": { schema: LoanBalanceUpdateRequest } },
        required: true,
      },
    },
    responses: {
      200: json(LoanBalanceUpdateResponse, "The adjustment, the balances and the account"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan or account not found"),
      409: json(ErrorBody, "The balance is no longer the one confirmed (balance_changed)"),
      422: json(ErrorBody, "Not a loan, closed, or an invalid request"),
    },
  }),
  async (c) => {
    const { budget_id, account_id } = c.req.valid("param");
    try {
      const data = await updateLoanBalance(
        c.env,
        c.get("identity").actor,
        budget_id,
        account_id,
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
);
