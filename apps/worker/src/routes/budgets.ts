import {
  BudgetCreate,
  BudgetListResponse,
  BudgetResponse,
  BudgetUpdate,
} from "@budget/schema/budgets";
import { ErrorBody } from "@budget/schema/common/envelope";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  BudgetRefused,
  createBudget,
  deleteBudget,
  getBudget,
  listBudgets,
  updateBudget,
} from "../services/budgets";

const tags = ["Budgets"];
const Params = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  400: json(ErrorBody, "Bad request"),
  403: json(ErrorBody, "Forbidden"),
};
const notFound = { 404: json(ErrorBody, "Not found") };
const refused = {
  422: json(
    ErrorBody,
    "Refused: unknown_currency, number_format_not_offered or unknown_date_format. Nothing changed.",
  ),
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
      path: "/budgets",
      tags,
      responses: { 200: json(BudgetListResponse, "Plans"), ...errors },
    }),
    async (c) => c.json({ data: { budgets: await listBudgets(c.env) } }, 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/budgets",
      tags,
      request: {
        body: { content: { "application/json": { schema: BudgetCreate } }, required: true },
      },
      responses: { 201: json(BudgetResponse, "Created"), ...errors, ...refused },
    }),
    async (c) => {
      try {
        const budget = await createBudget(c.env, c.get("identity").actor, c.req.valid("json"));
        return c.json({ data: { budget } }, 201);
      } catch (e) {
        if (e instanceof BudgetRefused) return apiError(c, e.status, e.code, e.message) as never;
        throw e;
      }
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{id}",
      tags,
      request: { params: Params },
      responses: { 200: json(BudgetResponse, "Plan"), ...errors, ...notFound },
    }),
    async (c) => {
      return c.json({ data: { budget: await getBudget(c.env, c.req.valid("param").id) } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/budgets/{id}",
      tags,
      description:
        "Update a plan: name, bank_environment, formats, expected_income (milliunits; 0 or null clears it; a negative is 422 negative_expected_income), or flag_names (merges per colour; null or blank clears one, null resets all; a trimmed name over 50 characters is 422 flag_name_too_long; an unknown colour is refused).",
      request: {
        params: Params,
        body: { content: { "application/json": { schema: BudgetUpdate } }, required: true },
      },
      responses: { 200: json(BudgetResponse, "Updated"), ...errors, ...notFound, ...refused },
    }),
    async (c) => {
      try {
        const budget = await updateBudget(
          c.env,
          c.get("identity").actor,
          c.req.valid("param").id,
          c.req.valid("json"),
        );
        return c.json({ data: { budget } }, 200);
      } catch (e) {
        if (e instanceof BudgetRefused) return apiError(c, e.status, e.code, e.message) as never;
        throw e;
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/budgets/{id}",
      tags,
      request: { params: Params },
      responses: {
        200: json(z.object({ data: z.object({ deleted: z.literal(true) }) }), "Deleted"),
        ...errors,
        ...notFound,
      },
    }),
    async (c) => {
      await deleteBudget(c.env, c.get("identity").actor, c.req.valid("param").id);
      return c.json({ data: { deleted: true as const } }, 200);
    },
  );
