import { CardPaymentRequest, CardPaymentResponse } from "@budget/schema/card-payments";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { payCreditCard } from "../services/card-payments";
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
    path: "/budgets/{budget_id}/accounts/{account_id}/payments",
    tags: ["Accounts"],
    summary: "Pay a credit card or line of credit from an on-plan cash account",
    request: {
      params: z.object({ budget_id: param("budget_id"), account_id: param("account_id") }),
      body: { required: true, content: { "application/json": { schema: CardPaymentRequest } } },
    },
    responses: {
      201: json(CardPaymentResponse, "The two transactions of the payment"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan or account not found"),
      422: json(ErrorBody, "Invalid request"),
    },
  }),
  async (c) => {
    const { budget_id, account_id } = c.req.valid("param");
    try {
      const data = await payCreditCard(
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
