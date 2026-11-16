import { ErrorBody } from "@budget/schema/common/envelope";
import {
  InstitutionListResponse,
  InstitutionSearchQuery,
  PopularQuery,
} from "@budget/schema/institutions";
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { plaidFail } from "../plaid/http";
import { popularInstitutions, searchInstitutions } from "../services/institutions";

const tags = ["Institutions"];
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

export default app
  .openapi(
    createRoute({
      method: "get",
      path: "/institutions",
      tags,
      request: { query: InstitutionSearchQuery },
      responses: { 200: json(InstitutionListResponse, "Up to 10 matches"), ...errors },
    }),
    async (c) => {
      const { budget_id, query } = c.req.valid("query");
      try {
        return c.json(
          { data: { institutions: await searchInstitutions(c.env, budget_id, query) } },
          200,
        );
      } catch (err) {
        return plaidFail(c, err);
      }
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/institutions/popular",
      tags,
      request: { query: PopularQuery },
      responses: { 200: json(InstitutionListResponse, "Popular institutions"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("query");
      try {
        return c.json({ data: { institutions: await popularInstitutions(c.env, budget_id) } }, 200);
      } catch (err) {
        return plaidFail(c, err);
      }
    },
  );
