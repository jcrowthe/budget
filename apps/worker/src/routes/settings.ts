import { ErrorBody } from "@budget/schema/common/envelope";
import { SettingsPatch, SettingsResponse } from "@budget/schema/settings";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { apiError } from "../middleware/errors";
import { getSettings, updateSettings } from "../services/settings";

const tags = ["Settings"];
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  403: json(ErrorBody, "Forbidden"),
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
      path: "/settings",
      tags,
      responses: { 200: json(SettingsResponse, "The signed-in user's display options"), ...errors },
    }),
    async (c) => c.json({ data: await getSettings(c.env, c.get("identity").actor) }, 200),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/settings",
      tags,
      request: {
        body: { content: { "application/json": { schema: SettingsPatch } }, required: true },
      },
      responses: { 200: json(SettingsResponse, "The updated display options"), ...errors },
    }),
    async (c) => {
      const data = await updateSettings(c.env, c.get("identity").actor, c.req.valid("json"));
      return c.json({ data }, 200);
    },
  );
