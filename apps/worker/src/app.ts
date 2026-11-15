import { OpenAPIHono } from "@hono/zod-openapi";
import type { JWTVerifyGetKey } from "jose";
import type { AppEnv } from "./env";
import { mcpRoute } from "./mcp/server";
import { accessMiddleware } from "./middleware/access";
import { notFoundApi, onError } from "./middleware/errors";
import { idempotency } from "./middleware/idempotency";

// Every module in routes/ exports a default OpenAPIHono with paths relative to /api/v1.
const routeModules = import.meta.glob<{ default: OpenAPIHono<AppEnv> }>("./routes/*.ts", {
  eager: true,
});

export function createApp(opts: { getKey?: JWTVerifyGetKey } = {}) {
  const app = new OpenAPIHono<AppEnv>();
  app.onError(onError);
  app.use("*", accessMiddleware(opts));
  app.use("/api/v1/*", idempotency());
  for (const key of Object.keys(routeModules).sort()) {
    const mod = routeModules[key];
    if (mod) app.route("/api/v1", mod.default);
  }
  app.doc31("/api/v1/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Budget API", version: "1" },
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "AccessClientId", {
    type: "apiKey",
    in: "header",
    name: "CF-Access-Client-Id",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "AccessClientSecret", {
    type: "apiKey",
    in: "header",
    name: "CF-Access-Client-Secret",
  });
  app.all("/mcp", mcpRoute);
  app.all("/api/*", notFoundApi);
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
