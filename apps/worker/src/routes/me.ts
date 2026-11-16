import { ErrorBody } from "@budget/schema/common/envelope";
import { MeResponse } from "@budget/schema/me";
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import type { AppEnv } from "../env";

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

const getMe = createRoute({
  method: "get",
  path: "/me",
  tags: ["Identity"],
  summary: "Who is signed in",
  responses: {
    200: json(MeResponse, "The signed-in identity"),
    403: json(ErrorBody, "Forbidden"),
  },
});

export default new OpenAPIHono<AppEnv>().openapi(getMe, (c) => {
  const id = c.get("identity");
  if (id.kind === "user")
    return c.json({ data: { kind: "user" as const, email: id.email ?? "" } }, 200);
  return c.json(
    { data: { kind: "service" as const, name: id.actor.replace(/^service:/, "") } },
    200,
  );
});
