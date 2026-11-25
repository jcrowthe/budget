import { ErrorBody } from "@budget/schema/common/envelope";
import { InputMonth } from "@budget/schema/months";
import {
  TargetDeletedResponse,
  TargetPutBody,
  TargetResponse,
  TargetSnoozeBody,
  TargetSnoozeResponse,
  Today,
} from "@budget/schema/targets";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ZodError } from "zod";
import type { AppEnv } from "../env";
import { apiError, NotFound } from "../middleware/errors";
import { PaymentLocked } from "../services/credit-payments";
import {
  deleteTarget,
  SnoozeRefused,
  setCardPaymentTarget,
  setDebtPaymentTarget,
  setTarget,
  setTargetSnooze,
  TargetRefused,
} from "../services/targets";

const tags = ["Targets"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan, category or target not found"),
  409: json(ErrorBody, "The target was changed concurrently"),
  422: json(
    ErrorBody,
    "Invalid target or date; payment_category_target: an ordinary target on a credit card payment category; card_target_requires_payment_category: a card target on an ordinary category; debt_target_requires_loan_category: a debt payment target on a category not paired with an open loan",
  ),
};

/**
 * The readable text of a failed body. TargetPutBody is a union of an ordinary, a card and a debt body: a bare
 * union says only "Invalid input", so the issues of the branch the body meant are used (`type` "debt_payment":
 * the debt one; any other `type`: the card one).
 */
async function issueText(
  error: ZodError,
  c: { req: { json: () => Promise<unknown> } },
): Promise<string> {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const typed = typeof body === "object" && body !== null && "type" in body;
  const branch = !typed ? 0 : body?.type === "debt_payment" ? 2 : 1;
  const flat = error.issues.flatMap((i) => {
    if (i.code !== "invalid_union") return [i];
    const issues = (i as { errors?: ZodError["issues"][] }).errors?.[branch];
    return issues ?? [i];
  });
  return flat.map((i) => i.message).join("; ");
}

const app = new OpenAPIHono<AppEnv>({
  defaultHook: async (result, c) => {
    if (!result.success) {
      return apiError(c, 422, "unprocessable_entity", await issueText(result.error, c));
    }
  },
});

const params = z.object({
  budget_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "budget_id", in: "path" } }),
  category_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "category_id", in: "path" } }),
});

const isId = (s: string) => z.uuid().safeParse(s).success;
const requireIds = (budgetId: string, categoryId: string) => {
  if (!isId(budgetId)) throw new NotFound("Plan");
  if (!isId(categoryId)) throw new NotFound("Category");
};

export default app
  .openapi(
    createRoute({
      method: "put",
      path: "/budgets/{budget_id}/categories/{category_id}/target",
      tags,
      request: {
        params,
        query: z.object({
          today: Today.optional().openapi({
            description:
              "The owner's local date (YYYY-MM-DD): the creation date of a new target. Default: the server's UTC date",
          }),
        }),
        body: { required: true, content: { "application/json": { schema: TargetPutBody } } },
      },
      responses: { 200: json(TargetResponse, "The stored target"), ...errors },
    }),
    async (c) => {
      const { budget_id, category_id } = c.req.valid("param");
      const { today } = c.req.valid("query");
      requireIds(budget_id, category_id);
      try {
        const body = c.req.valid("json");
        const actor = c.get("identity").actor;
        const target =
          "type" in body
            ? body.type === "debt_payment"
              ? await setDebtPaymentTarget(
                  c.env,
                  actor,
                  { budget_id, category_id, ...body },
                  { today },
                )
              : await setCardPaymentTarget(
                  c.env,
                  actor,
                  { budget_id, category_id, ...body },
                  { today },
                )
            : await setTarget(c.env, actor, { budget_id, category_id, ...body }, { today });
        return c.json({ data: { target } }, 200);
      } catch (e) {
        if (e instanceof ZodError) {
          return apiError(
            c,
            422,
            "unprocessable_entity",
            e.issues.map((i) => i.message).join("; "),
          ) as never;
        }
        if (e instanceof PaymentLocked || e instanceof TargetRefused)
          return apiError(c, 422, e.code, e.message) as never;
        throw e;
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/budgets/{budget_id}/categories/{category_id}/target",
      tags,
      request: { params },
      responses: { 200: json(TargetDeletedResponse, "The target as it was"), ...errors },
    }),
    async (c) => {
      const { budget_id, category_id } = c.req.valid("param");
      requireIds(budget_id, category_id);
      const deleted = await deleteTarget(c.env, c.get("identity").actor, {
        budget_id,
        category_id,
      });
      return c.json({ data: { deleted } }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/budgets/{budget_id}/months/{month}/categories/{category_id}/target-snooze",
      tags,
      request: {
        params: params.extend({
          month: InputMonth.openapi({ param: { name: "month", in: "path" } }),
        }),
        query: z.object({
          today: Today.optional().openapi({
            description:
              "The owner's local date (YYYY-MM-DD); it decides the current month. Default: the server's UTC date",
          }),
        }),
        body: { required: true, content: { "application/json": { schema: TargetSnoozeBody } } },
      },
      responses: {
        200: json(TargetSnoozeResponse, "The snooze as stored"),
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id, category_id, month } = c.req.valid("param");
      const { today } = c.req.valid("query");
      requireIds(budget_id, category_id);
      try {
        const data = await setTargetSnooze(
          c.env,
          c.get("identity").actor,
          { budget_id, month, category_id, snoozed: c.req.valid("json").snoozed },
          { today },
        );
        return c.json({ data }, 200);
      } catch (e) {
        if (e instanceof SnoozeRefused) {
          return apiError(c, 422, "snooze_refused", e.message) as never;
        }
        throw e;
      }
    },
  );
