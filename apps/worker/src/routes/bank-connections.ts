import {
  BankConnectionCreate,
  BankConnectionDeleted,
  BankConnectionListResponse,
  BankConnectionParams,
  BankConnectionResponse,
  BankConnectionScope,
  BankConnectionsQuery,
  BankConnectionUpdate,
  LinkTokenCreate,
  LinkTokenResponse,
  PlanSyncResponse,
  SyncResultResponse,
} from "@budget/schema/bank-connections";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { plaidFail } from "../plaid/http";
import {
  BankConnectionRefused,
  createBankConnection,
  createLinkToken,
  createUpdateLinkToken,
  finishReset,
  getBankConnection,
  listBankConnections,
  removeBankConnection,
  renameBankConnection,
} from "../services/bank-connections";
import { syncBankConnection, syncPlan } from "../services/plaid-sync";

const tags = ["Bank connections"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  400: json(ErrorBody, "Bad request"),
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan not found"),
  422: json(ErrorBody, "Bank connections are not set up"),
  502: json(ErrorBody, "Plaid error"),
};

const idErrors = {
  ...errors,
  404: json(ErrorBody, "Plan or bank connection not found"),
  409: json(ErrorBody, "Reset too soon or connection broken"),
};

/** Answers a refusal with its own status and code; Plaid errors and anything else as `plaidFail` does. */
function refusalOr(c: Context, err: unknown): never {
  if (err instanceof BankConnectionRefused) {
    return c.json(
      { error: { id: String(err.status), name: err.code, detail: err.message } },
      err.status,
    ) as never;
  }
  return plaidFail(c, err);
}

const idRequest = { params: BankConnectionParams, query: BankConnectionScope };

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return apiError(c, 400, "bad_request", result.error.issues.map((i) => i.message).join("; "));
    }
  },
});

/** The link-token route answers 200 and the web sends no Idempotency-Key: the token must not be stored. */
export default app
  .openapi(
    createRoute({
      method: "get",
      path: "/bank-connections",
      tags,
      request: { query: BankConnectionsQuery },
      responses: {
        200: json(BankConnectionListResponse, "The plan's environment's connections"),
        ...errors,
      },
    }),
    async (c) =>
      c.json(
        {
          data: {
            bank_connections: await listBankConnections(c.env, c.req.valid("query").budget_id),
          },
        },
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/bank-connections/link-token",
      tags,
      request: {
        body: { content: { "application/json": { schema: LinkTokenCreate } }, required: true },
      },
      responses: { 200: json(LinkTokenResponse, "A Plaid Link token"), ...errors },
    }),
    async (c) => {
      try {
        return c.json({ data: await createLinkToken(c.env, c.req.valid("json").budget_id) }, 200);
      } catch (err) {
        return plaidFail(c, err);
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/bank-connections",
      tags,
      request: {
        body: { content: { "application/json": { schema: BankConnectionCreate } }, required: true },
      },
      responses: { 201: json(BankConnectionResponse, "Created"), ...errors },
    }),
    async (c) => {
      try {
        const bank_connection = await createBankConnection(
          c.env,
          c.get("identity").actor,
          c.req.valid("json"),
        );
        return c.json({ data: { bank_connection } }, 201);
      } catch (err) {
        return plaidFail(c, err);
      }
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/bank-connections/{id}",
      tags,
      request: idRequest,
      responses: { 200: json(BankConnectionResponse, "The connection"), ...idErrors },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const bank_connection = await getBankConnection(c.env, c.req.valid("query").budget_id, id);
      return c.json({ data: { bank_connection } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/bank-connections/{id}",
      tags,
      request: {
        ...idRequest,
        body: { content: { "application/json": { schema: BankConnectionUpdate } }, required: true },
      },
      responses: {
        200: json(BankConnectionResponse, "The renamed connection"),
        ...idErrors,
        422: json(ErrorBody, "Invalid nickname"),
      },
    }),
    async (c) => {
      const bank_connection = await renameBankConnection(c.env, c.get("identity").actor, {
        budget_id: c.req.valid("query").budget_id,
        id: c.req.valid("param").id,
        nickname: c.req.valid("json").nickname,
      });
      return c.json({ data: { bank_connection } }, 200);
    },
    (result, c) => {
      if (!result.success) {
        return apiError(
          c,
          422,
          "unprocessable_entity",
          result.error.issues.map((i) => i.message).join("; "),
        ) as never;
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/bank-connections/{id}/link-token",
      tags,
      request: idRequest,
      responses: { 200: json(LinkTokenResponse, "A Plaid Link token in update mode"), ...idErrors },
    }),
    async (c) => {
      try {
        return c.json(
          {
            data: await createUpdateLinkToken(
              c.env,
              c.req.valid("query").budget_id,
              c.req.valid("param").id,
            ),
          },
          200,
        );
      } catch (err) {
        return refusalOr(c, err);
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/bank-connections/{id}/reset",
      tags,
      request: idRequest,
      responses: {
        200: json(BankConnectionResponse, "The connection, connected again"),
        ...idErrors,
      },
    }),
    async (c) => {
      const bank_connection = await finishReset(
        c.env,
        c.get("identity").actor,
        c.req.valid("query").budget_id,
        c.req.valid("param").id,
      );
      return c.json({ data: { bank_connection } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/bank-connections/{id}",
      tags,
      request: idRequest,
      responses: {
        200: json(BankConnectionDeleted, "Removed at Plaid and in Budget"),
        ...idErrors,
      },
    }),
    async (c) => {
      try {
        return c.json(
          {
            data: await removeBankConnection(
              c.env,
              c.get("identity").actor,
              c.req.valid("query").budget_id,
              c.req.valid("param").id,
            ),
          },
          200,
        );
      } catch (err) {
        return refusalOr(c, err);
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/bank-connections/{id}/sync",
      tags,
      request: idRequest,
      responses: {
        200: json(
          SyncResultResponse,
          "One sync run: the counts and the connection's status (a bank error is a status, not an error)",
        ),
        ...idErrors,
      },
    }),
    async (c) =>
      c.json(
        {
          data: await syncBankConnection(
            c.env,
            c.req.valid("query").budget_id,
            c.req.valid("param").id,
          ),
        },
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets/{budget_id}/sync",
      tags,
      request: {
        params: z.object({
          budget_id: z
            .string()
            .min(1)
            .openapi({ param: { name: "budget_id", in: "path" } }),
        }),
      },
      responses: {
        200: json(PlanSyncResponse, "One sync run for each connection linked to the plan"),
        ...errors,
      },
    }),
    async (c) => c.json({ data: await syncPlan(c.env, c.req.valid("param").budget_id) }, 200),
  );
