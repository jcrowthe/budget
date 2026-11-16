import { IsoDate } from "@budget/schema/common/dates";
import { ErrorBody } from "@budget/schema/common/envelope";
import { PLAN_SORT_COLUMNS, REGISTER_SORT_COLUMNS } from "@budget/schema/register";
import {
  PlanTransactionListResponse,
  TRANSACTION_NEEDS,
  TransactionCreateRequest,
  TransactionIdsRequest,
  TransactionListResponse,
  TransactionResponse,
  TransactionsResponse,
  TransactionUpdateRequest,
} from "@budget/schema/transactions";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  addTransaction,
  approveTransactions,
  deleteTransaction,
  getTransaction,
  listAccountTransactions,
  listPlanTransactions,
  rejectTransactions,
  TransactionRefused,
  updateTransaction,
} from "../services/transactions";

const tags = ["Transactions"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const param = (name: string) =>
  z
    .string()
    .min(1)
    .openapi({ param: { name, in: "path" } });
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan, account or transaction not found"),
  409: json(
    ErrorBody,
    "The transaction (or the other side of its transfer) is reconciled, locked, or changed concurrently",
  ),
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

async function refusals<T>(c: Parameters<typeof apiError>[0], run: () => Promise<T>) {
  try {
    return await run();
  } catch (e) {
    if (e instanceof TransactionRefused) {
      return apiError(c, e.status, e.code, e.message) as never;
    }
    throw e;
  }
}

export default app
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/accounts/{account_id}/transactions",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id"), account_id: param("account_id") }),
        query: z.object({
          since_date: IsoDate.optional(),
          sort: z.enum(REGISTER_SORT_COLUMNS).optional(),
          dir: z.enum(["asc", "desc"]).optional(),
          needs: z
            .enum(TRANSACTION_NEEDS)
            .optional()
            .describe(
              "approval_or_category: only transactions that are unapproved or need a category",
            ),
        }),
      },
      responses: {
        200: json(TransactionListResponse, "The account's transactions and balances"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, account_id } = c.req.valid("param");
      const q = c.req.valid("query");
      const data = await listAccountTransactions(c.env, budget_id, account_id, {
        sinceDate: q.since_date,
        sort: q.sort,
        dir: q.dir,
        needs: q.needs,
      });
      return c.json({ data }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/transactions",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id") }),
        query: z.object({
          since_date: IsoDate.optional(),
          sort: z.enum(PLAN_SORT_COLUMNS).optional(),
          dir: z.enum(["asc", "desc"]).optional(),
          needs: z
            .enum(TRANSACTION_NEEDS)
            .optional()
            .describe(
              "approval_or_category: only transactions that are unapproved or need a category",
            ),
        }),
      },
      responses: {
        200: json(
          PlanTransactionListResponse,
          "Every account's transactions with account_name, and the open accounts' balances",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const q = c.req.valid("query");
      const data = await listPlanTransactions(c.env, budget_id, {
        sinceDate: q.since_date,
        sort: q.sort,
        dir: q.dir,
        needs: q.needs,
      });
      return c.json({ data }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/transactions/{transaction_id}",
      tags,
      request: {
        params: z.object({
          budget_id: param("budget_id"),
          transaction_id: param("transaction_id"),
        }),
      },
      responses: { 200: json(TransactionResponse, "The transaction"), ...errors },
    }),
    async (c) => {
      const { budget_id, transaction_id } = c.req.valid("param");
      return c.json(
        { data: { transaction: await getTransaction(c.env, budget_id, transaction_id) } },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/transactions",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id") }),
        body: {
          content: { "application/json": { schema: TransactionCreateRequest } },
          required: true,
        },
      },
      responses: { 201: json(TransactionResponse, "The new transaction"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const body = c.req.valid("json");
      const actor = c.get("identity").actor;
      return refusals(c, async () => {
        const transaction = await addTransaction(c.env, actor, budget_id, body);
        return c.json({ data: { transaction } }, 201);
      });
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/budgets/{budget_id}/transactions/{transaction_id}",
      tags,
      request: {
        params: z.object({
          budget_id: param("budget_id"),
          transaction_id: param("transaction_id"),
        }),
        body: {
          content: { "application/json": { schema: TransactionUpdateRequest } },
          required: true,
        },
      },
      responses: { 200: json(TransactionResponse, "The transaction after the change"), ...errors },
    }),
    async (c) => {
      const { budget_id, transaction_id } = c.req.valid("param");
      const body = c.req.valid("json");
      const actor = c.get("identity").actor;
      return refusals(c, async () => {
        const transaction = await updateTransaction(c.env, actor, budget_id, transaction_id, body);
        return c.json({ data: { transaction } }, 200);
      });
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/budgets/{budget_id}/transactions/{transaction_id}",
      tags,
      request: {
        params: z.object({
          budget_id: param("budget_id"),
          transaction_id: param("transaction_id"),
        }),
      },
      responses: { 200: json(TransactionResponse, "The transaction as it was"), ...errors },
    }),
    async (c) => {
      const { budget_id, transaction_id } = c.req.valid("param");
      const actor = c.get("identity").actor;
      return refusals(c, async () => {
        const transaction = await deleteTransaction(c.env, actor, budget_id, transaction_id);
        return c.json({ data: { transaction } }, 200);
      });
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/transactions/approve",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id") }),
        body: {
          content: { "application/json": { schema: TransactionIdsRequest } },
          required: true,
        },
      },
      responses: {
        200: json(TransactionsResponse, "The transactions after approval, in the order given"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { ids } = c.req.valid("json");
      const actor = c.get("identity").actor;
      return refusals(c, async () => {
        const transactions = await approveTransactions(c.env, actor, budget_id, ids);
        return c.json({ data: { transactions } }, 200);
      });
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/transactions/reject",
      tags,
      request: {
        params: z.object({ budget_id: param("budget_id") }),
        body: {
          content: { "application/json": { schema: TransactionIdsRequest } },
          required: true,
        },
      },
      responses: {
        200: json(
          TransactionsResponse,
          "The rejected transactions as they were. An approved one is refused (409 transaction_approved); a transaction that did not come from an import is refused (422 not_imported)",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { ids } = c.req.valid("json");
      const actor = c.get("identity").actor;
      return refusals(c, async () => {
        const transactions = await rejectTransactions(c.env, actor, budget_id, ids);
        return c.json({ data: { transactions } }, 200);
      });
    },
  );
