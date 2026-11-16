import {
  AccountLinkRequest,
  AccountResponse,
  AccountsFromBankRequest,
  AccountsFromBankResponse,
} from "@budget/schema/accounts";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { createAccountsFromBank, linkAccount, unlinkAccount } from "../services/account-links";
import { LinkRefused } from "../services/accounts";

const tags = ["Accounts"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const budgetParam = z
  .string()
  .min(1)
  .openapi({ param: { name: "budget_id", in: "path" } });
const accountParams = z.object({
  budget_id: budgetParam,
  account_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "account_id", in: "path" } }),
});
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan, account or bank account not found"),
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
      method: "post",
      path: "/budgets/{budget_id}/accounts/from-bank",
      tags,
      request: {
        params: z.object({ budget_id: budgetParam }),
        body: {
          content: { "application/json": { schema: AccountsFromBankRequest } },
          required: true,
        },
      },
      responses: {
        201: json(AccountsFromBankResponse, "The new accounts with their Starting Balances"),
        409: json(ErrorBody, "A bank account is already linked, or a name is taken"),
        422: json(ErrorBody, "Invalid request, or a cash account"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      try {
        const data = await createAccountsFromBank(
          c.env,
          c.get("identity").actor,
          budget_id,
          c.req.valid("json"),
        );
        return c.json({ data }, 201);
      } catch (e) {
        if (e instanceof LinkRefused) return apiError(c, e.status, e.code, e.message) as never;
        throw e;
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/accounts/{account_id}/link",
      tags,
      request: {
        params: accountParams,
        body: { content: { "application/json": { schema: AccountLinkRequest } }, required: true },
      },
      responses: {
        200: json(AccountResponse, "The linked account"),
        409: json(ErrorBody, "The account or the bank account is already linked"),
        422: json(ErrorBody, "Invalid request, or a cash or closed account"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, account_id } = c.req.valid("param");
      try {
        const account = await linkAccount(
          c.env,
          c.get("identity").actor,
          budget_id,
          account_id,
          c.req.valid("json"),
        );
        return c.json({ data: { account } }, 200);
      } catch (e) {
        if (e instanceof LinkRefused) return apiError(c, e.status, e.code, e.message) as never;
        throw e;
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/budgets/{budget_id}/accounts/{account_id}/link",
      tags,
      request: { params: accountParams },
      responses: { 200: json(AccountResponse, "The unlinked account"), ...errors },
    }),
    async (c) => {
      const { budget_id, account_id } = c.req.valid("param");
      const account = await unlinkAccount(c.env, c.get("identity").actor, budget_id, account_id);
      return c.json({ data: { account } }, 200);
    },
  );
