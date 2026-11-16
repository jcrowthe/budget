import { ErrorBody } from "@budget/schema/common/envelope";
import {
  NetWorthQuery,
  NetWorthResponse,
  ReportRangeQuery,
  ReportRangeResponse,
} from "@budget/schema/reports";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { exportNetWorth, getNetWorth, getReportRange } from "../services/reports";

const tags = ["Reports"];
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
      path: "/budgets/{budget_id}/reports/range",
      tags,
      request: { params: z.object({ budget_id: budgetParam }), query: ReportRangeQuery },
      responses: { 200: json(ReportRangeResponse, "The range after clamping"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      return c.json({ data: await getReportRange(c.env, budget_id, c.req.valid("query")) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/reports/net-worth",
      tags,
      request: { params: z.object({ budget_id: budgetParam }), query: NetWorthQuery },
      responses: { 200: json(NetWorthResponse, "Net worth by month"), ...errors },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      return c.json({ data: await getNetWorth(c.env, budget_id, c.req.valid("query")) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/budgets/{budget_id}/reports/net-worth/export",
      tags,
      request: { params: z.object({ budget_id: budgetParam }), query: NetWorthQuery },
      responses: {
        200: {
          description: "The report as a CSV file",
          content: { "text/csv": { schema: z.string() } },
        },
        ...errors,
      },
    }),
    async (c) => {
      const { budget_id } = c.req.valid("param");
      const { filename, csv } = await exportNetWorth(c.env, budget_id, c.req.valid("query"));
      return c.body(csv, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
    },
  );
