import { ErrorBody } from "@budget/schema/common/envelope";
import { FreshStartRequest, FreshStartResponse } from "@budget/schema/fresh-start";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { BudgetRefused } from "../services/budgets";
import { freshStartBudget } from "../services/fresh-start";

const tags = ["Budgets"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const detail = result.error.issues.map((i) => i.message).join("; ");
      // A name the rule refuses (empty, over 100 characters) is a refused name, like a clash: 422.
      if (result.error.issues.every((i) => i.path[0] === "name")) {
        return apiError(c, 422, "plan_name_invalid", detail);
      }
      return apiError(c, 400, "bad_request", detail);
    }
  },
});

export default app.openapi(
  createRoute({
    method: "post",
    path: "/budgets/{id}/fresh-start",
    tags,
    description:
      "Make a Fresh Start: copies the plan's structure (accounts, groups, categories, targets, scheduled transactions, payees, notes, expected income, flag names, renaming rules, custom views) into a new plan that starts today, with a $0 Starting Balance per unlinked account and no transactions or assigned amounts, and renames this plan `<name> (Archived on YYYY-MM-DD)`. Linked accounts stay linked in the new plan (Starting Balance = the bank's balance); with stop_importing_in_archive (default true) the archive's links are removed so imports continue only in the new plan. A name equal to an active plan's name (any case, spaces trimmed) is 422 plan_name_taken. Not undoable.",
    request: {
      params: z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) }),
      body: { content: { "application/json": { schema: FreshStartRequest } }, required: true },
    },
    responses: {
      201: json(FreshStartResponse, "The new plan and the archived plan"),
      400: json(ErrorBody, "Bad request"),
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan not found"),
      409: json(ErrorBody, "The plan changed while it was copied; nothing was written"),
      422: json(
        ErrorBody,
        "plan_name_taken (The plan name already exists.) or plan_name_invalid (empty or over 100 characters). Nothing changed.",
      ),
    },
  }),
  async (c) => {
    try {
      const data = await freshStartBudget(
        c.env,
        c.get("identity").actor,
        c.req.valid("param").id,
        c.req.valid("json"),
      );
      return c.json({ data }, 201);
    } catch (e) {
      if (e instanceof BudgetRefused) return apiError(c, e.status, e.code, e.message) as never;
      throw e;
    }
  },
);
