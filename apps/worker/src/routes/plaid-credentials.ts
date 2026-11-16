import { ErrorBody } from "@budget/schema/common/envelope";
import {
  PlaidCredentialPutResponse,
  PlaidCredentialsPut,
  PlaidCredentialsResponse,
} from "@budget/schema/plaid-credentials";
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { listPlaidCredentials, putPlaidCredentials } from "../services/plaid-credentials";

const tags = ["Plaid"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = { 400: json(ErrorBody, "Bad request"), 403: json(ErrorBody, "Forbidden") };

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return apiError(c, 400, "bad_request", result.error.issues.map((i) => i.message).join("; "));
    }
  },
});

export default app
  .openapi(
    createRoute({
      method: "put",
      path: "/plaid/credentials",
      tags,
      request: {
        body: { content: { "application/json": { schema: PlaidCredentialsPut } }, required: true },
      },
      responses: { 200: json(PlaidCredentialPutResponse, "Stored (write-only)"), ...errors },
    }),
    async (c) =>
      c.json(
        { data: await putPlaidCredentials(c.env, c.get("identity").actor, c.req.valid("json")) },
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/plaid/credentials",
      tags,
      responses: { 200: json(PlaidCredentialsResponse, "Which environments are set"), ...errors },
    }),
    async (c) => c.json({ data: { credentials: await listPlaidCredentials(c.env) } }, 200),
  );
