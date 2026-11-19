import { ErrorBody } from "@budget/schema/common/envelope";
import {
  RenameRuleCreate,
  RenameRuleIdParam,
  RenameRuleListResponse,
  RenameRulePayeeParam,
  RenameRuleResponse,
  RenameRuleUpdate,
} from "@budget/schema/rename-rules";
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import {
  createRenameRule,
  deleteRenameRule,
  listRenameRules,
  updateRenameRule,
} from "../services/payee-rename-rules";
import { PayeeRefused } from "../services/payees";

const tags = ["Payees"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

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

const base = "/budgets/{budget_id}/payees/{payee_id}/rename-rules";

export default app
  .openapi(
    createRoute({
      method: "get",
      path: base,
      tags,
      request: { params: RenameRulePayeeParam },
      responses: { 200: json(RenameRuleListResponse, "The payee's renaming rules"), ...errors },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id, payee_id } = c.req.valid("param");
        return c.json({ data: { rules: await listRenameRules(c.env, budget_id, payee_id) } }, 200);
      }),
  )
  .openapi(
    createRoute({
      method: "post",
      path: base,
      tags,
      request: {
        params: RenameRulePayeeParam,
        body: { content: { "application/json": { schema: RenameRuleCreate } }, required: true },
      },
      responses: { 201: json(RenameRuleResponse, "The new rule"), ...errors },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id, payee_id } = c.req.valid("param");
        const rule = await createRenameRule(
          c.env,
          c.get("identity").actor,
          budget_id,
          payee_id,
          c.req.valid("json"),
        );
        return c.json({ data: { rule } }, 201);
      }),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: `${base}/{rule_id}`,
      tags,
      request: {
        params: RenameRuleIdParam,
        body: { content: { "application/json": { schema: RenameRuleUpdate } }, required: true },
      },
      responses: { 200: json(RenameRuleResponse, "The updated rule"), ...errors },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id, payee_id, rule_id } = c.req.valid("param");
        const rule = await updateRenameRule(
          c.env,
          c.get("identity").actor,
          budget_id,
          payee_id,
          rule_id,
          c.req.valid("json"),
        );
        return c.json({ data: { rule } }, 200);
      }),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: `${base}/{rule_id}`,
      tags,
      request: { params: RenameRuleIdParam },
      responses: { 200: json(RenameRuleResponse, "The deleted rule"), ...errors },
    }),
    (c) =>
      refusals(c, async () => {
        const { budget_id, payee_id, rule_id } = c.req.valid("param");
        const rule = await deleteRenameRule(
          c.env,
          c.get("identity").actor,
          budget_id,
          payee_id,
          rule_id,
        );
        return c.json({ data: { rule } }, 200);
      }),
  );
