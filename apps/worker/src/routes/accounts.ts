import {
  AccountCreateRequest,
  AccountCreateResponse,
  AccountListResponse,
  AccountResponse,
  AccountSummaryResponse,
  AccountUpdateRequest,
} from "@budget/schema/accounts";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  AccountRefused,
  addUnlinkedAccount,
  getAccount,
  getAccountSummary,
  listAccounts,
  NameTaken,
  UnsupportedAccountType,
  updateAccount,
} from "../services/accounts";

const tags = ["Accounts"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const budgetParam = z
  .string()
  .min(1)
  .openapi({ param: { name: "budget_id", in: "path" } });
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan or account not found"),
  422: json(ErrorBody, "Invalid request"),
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
      method: "get",
      path: "/budgets/{budget_id}/accounts",
      tags,
      request: {
        params: z.object({ budget_id: budgetParam }),
        query: z.object({ include_closed: z.enum(["true", "false"]).optional() }),
      },
      responses: { 200: json(AccountListResponse, "The plan's accounts"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { include_closed } = c.req.valid("query");
      const accounts = await listAccounts(c.env, budget_id, {
        includeClosed: include_closed !== "false",
      });
      return c.json({ data: { accounts } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/accounts/{account_id}",
      tags,
      request: {
        params: z.object({
          budget_id: budgetParam,
          account_id: z
            .string()
            .min(1)
            .openapi({ param: { name: "account_id", in: "path" } }),
        }),
      },
      responses: { 200: json(AccountResponse, "The account"), ...errors },
    }),
    async (c) => {
      const { budget_id, account_id } = c.req.valid("param");
      return c.json({ data: { account: await getAccount(c.env, budget_id, account_id) } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/budgets/{budget_id}/accounts/{account_id}",
      tags,
      request: {
        params: z.object({
          budget_id: budgetParam,
          account_id: z
            .string()
            .min(1)
            .openapi({ param: { name: "account_id", in: "path" } }),
        }),
        body: { content: { "application/json": { schema: AccountUpdateRequest } }, required: true },
      },
      responses: {
        200: json(AccountResponse, "The account after the change"),
        409: json(ErrorBody, "The account changed concurrently"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, account_id } = c.req.valid("param");
      try {
        const account = await updateAccount(
          c.env,
          c.get("identity").actor,
          budget_id,
          account_id,
          c.req.valid("json"),
        );
        return c.json({ data: { account } }, 200);
      } catch (e) {
        if (e instanceof AccountRefused) {
          return apiError(c, e.status, e.code, e.message) as never;
        }
        throw e;
      }
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/account-summary",
      tags,
      request: { params: z.object({ budget_id: budgetParam }) },
      responses: {
        200: json(
          AccountSummaryResponse,
          "Cleared, uncleared and working totals of every open account",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      return c.json({ data: { balances: await getAccountSummary(c.env, budget_id) } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/accounts",
      tags,
      request: {
        params: z.object({ budget_id: budgetParam }),
        body: { content: { "application/json": { schema: AccountCreateRequest } }, required: true },
      },
      responses: {
        201: json(AccountCreateResponse, "The account and its Starting Balance transaction"),
        409: json(ErrorBody, "The account name already exists"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      try {
        const data = await addUnlinkedAccount(
          c.env,
          c.get("identity").actor,
          budget_id,
          c.req.valid("json"),
        );
        return c.json({ data }, 201);
      } catch (e) {
        if (e instanceof NameTaken) return apiError(c, 409, "name_taken", e.message) as never;
        if (e instanceof UnsupportedAccountType) {
          return apiError(c, 422, "unprocessable_entity", e.message) as never;
        }
        throw e;
      }
    },
  );
