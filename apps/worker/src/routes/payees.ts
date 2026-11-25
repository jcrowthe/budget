import { ErrorBody } from "@budget/schema/common/envelope";
import {
  PayeeBulkRequest,
  PayeeBulkResponse,
  PayeeCombineRequest,
  PayeeCombineResponse,
  PayeeDeleteQuery,
  PayeeDeleteResponse,
  PayeeIdParam,
  PayeeListQuery,
  PayeeListResponse,
  PayeeRecentQuery,
  PayeeRecentResponse,
  PayeeResponse,
  PayeeTransactionsResponse,
  PayeeUpdate,
} from "@budget/schema/payees";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  applyToPayees,
  combinePayees,
  deletePayee,
  listPayeeRecentTransactions,
  listPayees,
  listPayeeTransactions,
  PayeeRefused,
  updatePayee,
} from "../services/payees";

const tags = ["Payees"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const budgetParam = z
  .string()
  .min(1)
  .openapi({ param: { name: "budget_id", in: "path" } });

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
    if (e instanceof PayeeRefused) return apiError(c, e.status, e.code, e.message) as never;
    throw e;
  }
}

const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Not found"),
  409: json(ErrorBody, "Conflict"),
  422: json(ErrorBody, "Invalid request"),
};
const budgetOnly = z.object({ budget_id: budgetParam });

export default app
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/payees",
      tags,
      request: { params: z.object({ budget_id: budgetParam }), query: PayeeListQuery },
      responses: {
        200: json(PayeeListResponse, "The plan's payees"),
        403: json(ErrorBody, "Forbidden"),
        404: json(ErrorBody, "Plan not found"),
        422: json(ErrorBody, "Invalid request"),
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { q, include_hidden } = c.req.valid("query");
      const payees = await listPayees(c.env, budget_id, {
        q,
        includeHidden: include_hidden === "true",
      });
      return c.json({ data: { payees } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/budgets/{budget_id}/payees/{payee_id}",
      tags,
      request: {
        params: PayeeIdParam,
        body: { content: { "application/json": { schema: PayeeUpdate } }, required: true },
      },
      responses: { 200: json(PayeeResponse, "The updated payee"), ...errors },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id, payee_id } = c.req.valid("param");
        const payee = await updatePayee(
          c.env,
          c.get("identity").actor,
          budget_id,
          payee_id,
          c.req.valid("json"),
        );
        return c.json({ data: { payee } }, 200);
      }),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/payees/bulk",
      tags,
      request: {
        params: budgetOnly,
        body: { content: { "application/json": { schema: PayeeBulkRequest } }, required: true },
      },
      responses: {
        200: json(PayeeBulkResponse, "The payees hidden, unhidden or deleted"),
        ...errors,
      },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id } = c.req.valid("param");
        const b = c.req.valid("json");
        const out = await applyToPayees(c.env, c.get("identity").actor, budget_id, {
          ids: b.payee_ids,
          action: b.action,
          replacementId: b.replacement_payee_id,
        });
        return c.json({ data: out }, 200);
      }),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/payees/combine",
      tags,
      request: {
        params: budgetOnly,
        body: { content: { "application/json": { schema: PayeeCombineRequest } }, required: true },
      },
      responses: {
        200: json(PayeeCombineResponse, "The surviving payee and the payees merged into it"),
        404: json(ErrorBody, "Plan not found"),
        409: json(ErrorBody, "Conflict"),
        422: json(ErrorBody, "Invalid request"),
      },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id } = c.req.valid("param");
        const b = c.req.valid("json");
        const out = await combinePayees(c.env, c.get("identity").actor, budget_id, {
          ids: b.payee_ids,
          name: b.name,
          targetId: b.target_payee_id,
        });
        return c.json({ data: out }, 200);
      }),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/budgets/{budget_id}/payees/{payee_id}",
      tags,
      request: { params: PayeeIdParam, query: PayeeDeleteQuery },
      responses: { 200: json(PayeeDeleteResponse, "The deleted payee"), ...errors },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id, payee_id } = c.req.valid("param");
        const { replacement_payee_id } = c.req.valid("query");
        const deleted = await deletePayee(
          c.env,
          c.get("identity").actor,
          budget_id,
          payee_id,
          replacement_payee_id ?? null,
        );
        return c.json({ data: { deleted } }, 200);
      }),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/payees/{payee_id}/transactions",
      tags,
      request: { params: PayeeIdParam },
      responses: { 200: json(PayeeTransactionsResponse, "The payee's transactions"), ...errors },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id, payee_id } = c.req.valid("param");
        return c.json({ data: await listPayeeTransactions(c.env, budget_id, payee_id) }, 200);
      }),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/payees/{payee_id}/recent-transactions",
      tags,
      request: { params: PayeeIdParam, query: PayeeRecentQuery },
      responses: {
        200: json(PayeeRecentResponse, "The payee's last counted transactions"),
        ...errors,
      },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id, payee_id } = c.req.valid("param");
        const { limit } = c.req.valid("query");
        return c.json(
          { data: await listPayeeRecentTransactions(c.env, budget_id, payee_id, limit) },
          200,
        );
      }),
  );
