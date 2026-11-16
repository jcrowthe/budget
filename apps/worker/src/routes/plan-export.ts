import { ErrorBody } from "@budget/schema/common/envelope";
import { PlanExportQuery } from "@budget/schema/plan-export";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { ExportNowOutOfRange, exportPlan } from "../services/plan-export";

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

app.openapi(
  createRoute({
    method: "get",
    path: "/budgets/{budget_id}/export",
    tags: ["Plans"],
    summary: "Export the plan as a ZIP of the Plan and Register files",
    request: { params: z.object({ budget_id: budgetParam }), query: PlanExportQuery },
    responses: {
      200: {
        description: "The plan as a ZIP of the Plan and Register files",
        content: { "application/zip": { schema: z.string().openapi({ format: "binary" }) } },
      },
      403: json(ErrorBody, "Forbidden"),
      404: json(ErrorBody, "Plan not found"),
      422: json(ErrorBody, "Invalid request"),
    },
  }),
  async (c) => {
    const { budget_id } = c.req.valid("param");
    let out: Awaited<ReturnType<typeof exportPlan>>;
    try {
      out = await exportPlan(c.env, budget_id, c.req.valid("query"));
    } catch (e) {
      if (e instanceof ExportNowOutOfRange) return apiError(c, 422, "unprocessable_entity", e.message);
      throw e;
    }
    const { fileName, bytes } = out;
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
  },
);

export default app;
