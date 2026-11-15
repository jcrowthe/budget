import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";

const route = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  responses: {
    200: {
      description: "Service status",
      content: {
        "application/json": {
          schema: z.object({ status: z.literal("ok"), deploy_sha: z.string() }),
        },
      },
    },
  },
});

export default new OpenAPIHono<AppEnv>().openapi(route, (c) =>
  c.json({ status: "ok" as const, deploy_sha: c.env.DEPLOY_SHA }, 200),
);
