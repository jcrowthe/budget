import {
  BankConnectionCreate,
  BankConnectionListResponse,
  BankConnectionResponse,
  BankConnectionsQuery,
  LinkTokenCreate,
  LinkTokenResponse,
} from "@budget/schema/bank-connections";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { plaidFail } from "../plaid/http";
import {
  createBankConnection,
  createLinkToken,
  listBankConnections,
} from "../services/bank-connections";

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
  );
