import { ErrorBody } from "@budget/schema/common/envelope";
import { LoanPairingRequest, LoanPairingResponse } from "@budget/schema/loan-summary";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { pairLoanCategory } from "../services/loan-pairing";
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
    method: "put",
    path: "/budgets/{budget_id}/accounts/{account_id}/paired-category",
    tags: ["Accounts"],
    summary: "Pair a loan with an existing plan category (or re-pair it)",
    request: {
      params: z.object({ budget_id: param("budget_id"), account_id: param("account_id") }),
      body: { content: { "application/json": { schema: LoanPairingRequest } }, required: true },
    },
    responses: {
      200: json(LoanPairingResponse, "The updated loan account"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan or account not found"),
      422: json(ErrorBody, "Not a loan, closed, or a category that cannot be paired"),
    },
  }),
  async (c) => {
    const { budget_id, account_id } = c.req.valid("param");
    try {
      const account = await pairLoanCategory(
        c.env,
        c.get("identity").actor,
        budget_id,
        account_id,
        c.req.valid("json"),
      );
      return c.json({ data: { account } }, 200);
    } catch (e) {
      if (e instanceof TransactionRefused) {
        return apiError(c, e.status, e.code, e.message) as never;
      }
      throw e;
    }
  },
);
