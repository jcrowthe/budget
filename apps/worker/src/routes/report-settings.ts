import { ErrorBody } from "@budget/schema/common/envelope";
import { ReportSettingsResponse, ReportSettingsUpdate, ReportSlug } from "@budget/schema/reports";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { getReportSettings, updateReportSettings } from "../services/report-settings";

const tags = ["Interface state"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const budgetParam = z
  .string()
  .min(1)
  .openapi({ param: { name: "budget_id", in: "path" } });
const errors = {
  403: json(ErrorBody, "Forbidden"),
  404: json(ErrorBody, "Plan not found"),
  422: json(ErrorBody, "Invalid request"),
};

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

export default app
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/report-settings",
      tags,
      request: { params: z.object({ budget_id: budgetParam }) },
      responses: { 200: json(ReportSettingsResponse, "Every report's settings"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      return c.json({ data: await getReportSettings(c.env, budget_id) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/budgets/{budget_id}/report-settings/{report}",
      tags,
      request: {
        params: z.object({
          budget_id: budgetParam,
          report: ReportSlug.openapi({ param: { name: "report", in: "path" } }),
        }),
        body: { content: { "application/json": { schema: ReportSettingsUpdate } }, required: true },
      },
      responses: { 200: json(ReportSettingsResponse, "Every report's settings"), ...errors },
    }),
    async (c) => {
      const { budget_id, report } = c.req.valid("param");
      const data = await updateReportSettings(c.env, budget_id, report, c.req.valid("json"));
      return c.json({ data }, 200);
    },
  );
